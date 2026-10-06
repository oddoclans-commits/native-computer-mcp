#!/usr/bin/env python3
import base64
import json
import sys
import os
import shutil
import subprocess

try:
    import pyatspi
except Exception as exc:
    print(json.dumps({"ok": False, "message": "pyatspi is unavailable: " + str(exc)}))
    sys.exit(1)

MAX_NODES = 500
node_count = 0

def rect_for(obj):
    try:
        component = obj.queryComponent()
        rect = component.getExtents(pyatspi.DESKTOP_COORDS)
        return {"x": int(rect.x), "y": int(rect.y), "width": int(rect.width), "height": int(rect.height)}
    except Exception:
        return None

def node_id(path):
    return "atspi:" + ".".join(str(x) for x in path)

def make_node(obj, path, depth=0, max_depth=8):
    global node_count
    if node_count >= MAX_NODES:
        return None
    node_count += 1

    try:
        role = obj.getRoleName() or "unknown"
        name = obj.name or ""
        value = None
        try:
            value = obj.queryValue().currentValue
            if value == 0:
                value = None
        except Exception:
            pass

        state = obj.getState()
        node = {
            "id": node_id(path),
            "role": role,
            "enabled": not state.contains(pyatspi.STATE_TYPE_DEFUNCT),
            "focused": state.contains(pyatspi.STATE_TYPE_FOCUSED),
        }
        if name:
            node["name"] = name
        if value is not None:
            node["value"] = str(value)

        rect = rect_for(obj)
        if rect:
            node["bounds"] = rect

        actions = []
        try:
            action = obj.queryAction()
            for index in range(action.nActions):
                actions.append(action.getName(index))
        except Exception:
            pass
        if actions:
            node["patterns"] = actions[:16]

        if depth < max_depth:
            children = []
            try:
                for index, child in enumerate(obj):
                    if len(children) >= 100:
                        break
                    child_node = make_node(child, path + [index], depth + 1, max_depth)
                    if child_node:
                        children.append(child_node)
            except Exception:
                pass
            if children:
                node["children"] = children

        return node
    except Exception:
        return None

def resolve(path):
    values = [int(x) for x in path]
    obj = pyatspi.Registry.getDesktop(0)
    for index in values:
        obj = obj[index]
    return obj

def perform_primary(obj):
    action = obj.queryAction()
    for index in range(action.nActions):
        name = (action.getName(index) or "").lower()
        if any(token in name for token in ("click", "press", "activate", "select")):
            action.doAction(index)
            return
    raise RuntimeError("AT-SPI target exposes no supported primary action.")

def pointer_click(obj, button):
    if not os.environ.get("DISPLAY"):
        raise RuntimeError("Native pointer fallback requires DISPLAY/X11.")
    tool = shutil.which("xdotool")
    if not tool:
        raise RuntimeError("Native pointer fallback requires xdotool.")
    rect = rect_for(obj)
    if not rect:
        raise RuntimeError("AT-SPI target has no usable bounds.")
    x = rect["x"] + max(0, rect["width"] // 2)
    y = rect["y"] + max(0, rect["height"] // 2)
    button_id = {"left": "1", "middle": "2", "right": "3"}[button]
    subprocess.run(
        [tool, "mousemove", "--sync", str(x), str(y)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    subprocess.run(
        [tool, "click", button_id],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )

def perform_secondary(obj):
    action = obj.queryAction()
    for index in range(action.nActions):
        name = (action.getName(index) or "").lower()
        if any(token in name for token in ("context", "popup", "menu", "secondary")):
            action.doAction(index)
            return
    pointer_click(obj, "right")

def set_value(obj, value):
    try:
        editable = obj.queryEditableText()
        editable.setTextContents(value)
        return
    except Exception:
        pass
    raise RuntimeError("AT-SPI target exposes no editable-text interface.")

def main(request):
    global node_count
    command = request.get("command")

    if command == "observe":
        node_count = 0
        desktop = pyatspi.Registry.getDesktop(0)
        root = make_node(desktop, [])
        return {
            "ok": True,
            "accessibility": [root] if root else [],
            "capabilities": ["ui_automation", "semantic_targets", "semantic_actions", "accessibility_atspi"]
        }

    if command == "act":
        action = request.get("payload", {})
        target_id = action.get("targetId", "")
        if not target_id.startswith("atspi:"):
            raise RuntimeError("AT-SPI semantic actions require an atspi: targetId.")
        path = target_id[6:].split(".") if target_id[6:] else []
        obj = resolve(path)

        if action.get("type") == "click":
            button = action.get("button", "left")
            if button == "left":
                perform_primary(obj)
            else:
                pointer_click(obj, button)
        elif action.get("type") == "secondary_action":
            perform_secondary(obj)
        elif action.get("type") == "set_value":
            set_value(obj, str(action.get("value", "")))
        else:
            raise RuntimeError("Unsupported AT-SPI semantic action.")

        return {"ok": True}

    raise RuntimeError("Unsupported AT-SPI command.")

try:
    payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    print(json.dumps(main(payload), separators=(",", ":")))
except Exception as exc:
    print(json.dumps({"ok": False, "message": str(exc)}, separators=(",", ":")))
    sys.exit(1)
