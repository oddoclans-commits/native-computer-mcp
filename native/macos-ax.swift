import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import Darwin

struct Point: Codable {
    let x: Double
    let y: Double
}

struct Bounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct Request: Codable {
    let command: String
    let payload: Payload?
}

struct Payload: Codable {
    let type: String?
    let targetId: String?
    let point: Point?
    let button: String?
    let value: String?
    let text: String?
    let modifiers: [String]?
    let deltaX: Double?
    let deltaY: Double?
    let from: Point?
    let to: Point?
    let durationMs: Int?
}

func attribute(_ element: AXUIElement, _ name: String) -> Any? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return error == .success ? value : nil
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
    attribute(element, name) as? String
}

func boolAttribute(_ element: AXUIElement, _ name: String) -> Bool? {
    attribute(element, name) as? Bool
}

func axValue(_ raw: Any?) -> AXValue? {
    guard let raw else { return nil }
    let cf = raw as CFTypeRef
    guard CFGetTypeID(cf) == AXValueGetTypeID() else { return nil }
    return raw as! AXValue
}

func axUIElement(_ raw: Any?) -> AXUIElement? {
    guard let raw else { return nil }
    let cf = raw as CFTypeRef
    guard CFGetTypeID(cf) == AXUIElementGetTypeID() else { return nil }
    return raw as! AXUIElement
}

func boundsAttribute(_ element: AXUIElement) -> Bounds? {
    guard let value = axValue(attribute(element, kAXPositionAttribute)),
          let sizeValue = axValue(attribute(element, kAXSizeAttribute)) else {
        return nil
    }

    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(value, .cgPoint, &position),
          AXValueGetValue(sizeValue, .cgSize, &size) else {
        return nil
    }

    return Bounds(
        x: Double(position.x),
        y: Double(position.y),
        width: Double(size.width),
        height: Double(size.height)
    )
}

func childElements(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

var nodeCount = 0

func makeNode(_ element: AXUIElement, path: [Int], depth: Int, maxDepth: Int = 8) -> [String: Any] {
    nodeCount += 1

    var node: [String: Any] = [
        "id": "ax:" + path.map(String.init).joined(separator: "."),
        "role": stringAttribute(element, kAXRoleAttribute) ?? "unknown",
        "enabled": boolAttribute(element, kAXEnabledAttribute) ?? true
    ]

    if let focused = boolAttribute(element, kAXFocusedAttribute) {
        node["focused"] = focused
    }
    if let selected = boolAttribute(element, kAXSelectedAttribute) {
        node["selected"] = selected
    }
    if let expanded = boolAttribute(element, kAXExpandedAttribute) {
        node["expanded"] = expanded
    }

    if let title = stringAttribute(element, kAXTitleAttribute), !title.isEmpty {
        node["name"] = title
    } else if let description = stringAttribute(element, kAXDescriptionAttribute), !description.isEmpty {
        node["name"] = description
    }

    if let value = stringAttribute(element, kAXValueAttribute) {
        node["value"] = value
    }

    if let bounds = boundsAttribute(element) {
        node["bounds"] = [
            "x": bounds.x, "y": bounds.y,
            "width": bounds.width, "height": bounds.height
        ]
    }

    var actions: [String] = []
    var actionNames: CFArray?
    if AXUIElementCopyActionNames(element, &actionNames) == .success,
       let names = actionNames as? [String] {
        actions = Array(names.prefix(16))
    }
    if !actions.isEmpty {
        node["patterns"] = actions
    }

    if depth < maxDepth && nodeCount < 500 {
        let children = childElements(element)
        var childNodes: [[String: Any]] = []
        for (index, child) in children.prefix(100).enumerated() {
            if nodeCount >= 500 { break }
            childNodes.append(makeNode(child, path: path + [index], depth: depth + 1))
        }
        if !childNodes.isEmpty {
            node["children"] = childNodes
        }
    }

    return node
}

func resolve(_ root: AXUIElement, path: [Int]) throws -> AXUIElement {
    var element = root
    for index in path {
        let children = childElements(element)
        guard index >= 0 && index < children.count else {
            throw NSError(domain: "native-computer-mcp", code: 2, userInfo: [NSLocalizedDescriptionKey: "AX target path is stale."])
        }
        element = children[index]
    }
    return element
}

func frontmostApplication() throws -> NSRunningApplication {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        throw NSError(domain: "native-computer-mcp", code: 1, userInfo: [NSLocalizedDescriptionKey: "No frontmost application."])
    }
    return app
}

func axRoot() throws -> AXUIElement {
    let app = try frontmostApplication()
    let root = AXUIElementCreateApplication(app.processIdentifier)

    if let window = axUIElement(attribute(root, kAXFocusedWindowAttribute)) {
        return window
    }
    return root
}

func click(_ point: CGPoint, _ button: CGMouseButton) {
    let downType: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
    let upType: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
    let source = CGEventSource(stateID: .combinedSessionState)
    CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button)?.post(tap: .cghidEventTap)
}

func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
    return (names as? [String]) ?? []
}

func invokeNamedAction(_ element: AXUIElement, names preferred: [String]) throws {
    let available = actionNames(element)
    if let exact = preferred.first(where: { available.contains($0) }) {
        let error = AXUIElementPerformAction(element, exact as CFString)
        if error == .success { return }
        throw NSError(
            domain: "native-computer-mcp",
            code: Int(error.rawValue),
            userInfo: [NSLocalizedDescriptionKey: "AX action failed: " + exact]
        )
    }
    throw NSError(
        domain: "native-computer-mcp",
        code: 20,
        userInfo: [NSLocalizedDescriptionKey: "Requested AX action is not supported."]
    )
}

func invoke(_ element: AXUIElement) throws {
    do {
        try invokeNamedAction(element, names: [kAXPressAction as String, "AXPress", "AXConfirm"])
        return
    } catch {
        guard let bounds = boundsAttribute(element) else {
            throw error
        }
        click(
            CGPoint(x: bounds.x + bounds.width / 2.0, y: bounds.y + bounds.height / 2.0),
            .left
        )
    }
}

func invokeSecondary(_ element: AXUIElement) throws {
    let available = actionNames(element)
    let preferred = ["AXShowMenu", "AXShowMenuAction", "AXContextMenu", "AXSecondary"]
    for name in preferred where available.contains(name) {
        let error = AXUIElementPerformAction(element, name as CFString)
        if error == .success { return }
    }

    guard let bounds = boundsAttribute(element) else {
        throw NSError(
            domain: "native-computer-mcp",
            code: 21,
            userInfo: [NSLocalizedDescriptionKey: "AX target has no bounds for secondary action."]
        )
    }
    click(
        CGPoint(x: bounds.x + bounds.width / 2.0, y: bounds.y + bounds.height / 2.0),
        .right
    )
}

func setValue(_ element: AXUIElement, _ value: String) throws {
    var settable = DarwinBoolean(false)
    let settableError = AXUIElementIsAttributeSettable(
        element,
        kAXValueAttribute as CFString,
        &settable
    )
    guard settableError == .success && settable.boolValue else {
        throw NSError(
            domain: "native-computer-mcp",
            code: 22,
            userInfo: [NSLocalizedDescriptionKey: "AX value attribute is not settable."]
        )
    }

    let error = AXUIElementSetAttributeValue(
        element,
        kAXValueAttribute as CFString,
        value as CFTypeRef
    )
    if error != .success {
        throw NSError(
            domain: "native-computer-mcp",
            code: Int(error.rawValue),
            userInfo: [NSLocalizedDescriptionKey: "AX value update failed."]
        )
    }
}

func modifierKeyCode(_ value: String) -> CGKeyCode? {
    switch value.lowercased() {
    case "command", "cmd", "meta", "logo": return 55
    case "shift": return 56
    case "option", "alt": return 58
    case "control", "ctrl": return 59
    case "rightshift": return 60
    case "rightoption": return 61
    case "rightcontrol": return 62
    default: return nil
    }
}

func keyCode(_ value: String) -> CGKeyCode? {
    let normalized = value.lowercased()
    let special: [String: CGKeyCode] = [
        "return": 36, "enter": 36, "tab": 48, "space": 49, "escape": 53,
        "esc": 53, "backspace": 51, "delete": 51,
        "left": 123, "right": 124, "down": 125, "up": 126,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121
    ]
    if let code = special[normalized] { return code }

    switch normalized {
    case "a": return 0; case "s": return 1; case "d": return 2; case "f": return 3
    case "h": return 4; case "g": return 5; case "z": return 6; case "x": return 7
    case "c": return 8; case "v": return 9; case "b": return 11; case "q": return 12
    case "w": return 13; case "e": return 14; case "r": return 15; case "y": return 16
    case "t": return 17; case "1": return 18; case "2": return 19; case "3": return 20
    case "4": return 21; case "6": return 22; case "5": return 23; case "7": return 26
    case "9": return 25; case "-": return 27; case "8": return 28; case "0": return 29
    case "]": return 30; case "o": return 31; case "u": return 32; case "[": return 33
    case "i": return 34; case "p": return 35; case "l": return 37; case "j": return 38
    case "'": return 39; case "k": return 40; case ";": return 41; case "\\": return 42
    case ",": return 43; case "/": return 44; case "n": return 45; case "m": return 46
    case ".": return 47
    case "f1": return 122; case "f2": return 120; case "f3": return 99; case "f4": return 118
    case "f5": return 96; case "f6": return 97; case "f7": return 98; case "f8": return 100
    case "f9": return 101; case "f10": return 109; case "f11": return 103; case "f12": return 111
    default: return nil
    }
}

func sendKey(_ value: String, modifiers: [String]) throws {
    guard let code = keyCode(value) else {
        throw NSError(domain: "native-computer-mcp", code: 30, userInfo: [NSLocalizedDescriptionKey: "Unsupported macOS key: " + value])
    }

    let source = CGEventSource(stateID: .combinedSessionState)
    var held: [CGKeyCode] = []
    for modifier in modifiers {
        guard let modCode = modifierKeyCode(modifier) else {
            throw NSError(domain: "native-computer-mcp", code: 31, userInfo: [NSLocalizedDescriptionKey: "Unsupported macOS modifier: " + modifier])
        }
        CGEvent(keyboardEventSource: source, virtualKey: modCode, keyDown: true)?.post(tap: .cghidEventTap)
        held.append(modCode)
    }

    CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)?.post(tap: .cghidEventTap)
    CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)?.post(tap: .cghidEventTap)

    for modCode in held.reversed() {
        CGEvent(keyboardEventSource: source, virtualKey: modCode, keyDown: false)?.post(tap: .cghidEventTap)
    }
}

func sendText(_ text: String) {
    let source = CGEventSource(stateID: .combinedSessionState)
    for scalar in text.unicodeScalars {
        var codeUnits = Array(String(scalar).utf16)
        if codeUnits.isEmpty { continue }

        if let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
           let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) {
            codeUnits.withUnsafeMutableBufferPointer { buffer in
                if let base = buffer.baseAddress {
                    down.keyboardSetUnicodeString(UInt32(buffer.count), unicodeString: base)
                    up.keyboardSetUnicodeString(UInt32(buffer.count), unicodeString: base)
                }
            }
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
    }
}

func sendScroll(_ deltaX: Double, _ deltaY: Double) {
    let source = CGEventSource(stateID: .combinedSessionState)
    if let event = CGEvent(
        scrollWheelEvent2Source: source,
        units: .pixel,
        wheelCount: 2,
        wheel1: Int32(deltaY),
        wheel2: Int32(deltaX),
        wheel3: 0
    ) {
        event.post(tap: .cghidEventTap)
    }
}

func sendDrag(_ from: CGPoint, _ to: CGPoint, durationMs: Int) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let steps = max(2, min(40, Int(ceil(Double(max(durationMs, 1)) / 20.0))))

    CGEvent(
        mouseEventSource: source,
        mouseType: .leftMouseDown,
        mouseCursorPosition: from,
        mouseButton: .left
    )?.post(tap: .cghidEventTap)

    for index in 1...steps {
        let t = CGFloat(index) / CGFloat(steps)
        let point = CGPoint(
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t
        )
        CGEvent(
            mouseEventSource: source,
            mouseType: .leftMouseDragged,
            mouseCursorPosition: point,
            mouseButton: .left
        )?.post(tap: .cghidEventTap)
        usleep(20_000)
    }

    CGEvent(
        mouseEventSource: source,
        mouseType: .leftMouseUp,
        mouseCursorPosition: to,
        mouseButton: .left
    )?.post(tap: .cghidEventTap)
}

func setValue(_ element: AXUIElement, _ value: String) throws {
    var settable = DarwinBoolean(false)
    let settableError = AXUIElementIsAttributeSettable(
        element,
        kAXValueAttribute as CFString,
        &settable
    )
    guard settableError == .success && settable.boolValue else {
        throw NSError(
            domain: "native-computer-mcp",
            code: 22,
            userInfo: [NSLocalizedDescriptionKey: "AX value attribute is not settable."]
        )
    }

    let error = AXUIElementSetAttributeValue(
        element,
        kAXValueAttribute as CFString,
        value as CFTypeRef
    )
    if error != .success {
        throw NSError(
            domain: "native-computer-mcp",
            code: Int(error.rawValue),
            userInfo: [NSLocalizedDescriptionKey: "AX value update failed."]
        )
    }
}

func main(_ request: Request) throws -> [String: Any] {
    guard AXIsProcessTrusted() else {
        throw NSError(domain: "native-computer-mcp", code: 100, userInfo: [NSLocalizedDescriptionKey: "macOS Accessibility permission is not granted."])
    }

    let root = try axRoot()

    if request.command == "observe" {
        nodeCount = 0
        let app = try frontmostApplication()

        var result: [String: Any] = [
            "ok": true,
            "accessibility": [makeNode(root, path: [], depth: 0)],
            "capabilities": [
                "native_input",
                "ui_automation",
                "semantic_targets",
                "semantic_actions",
                "accessibility_ax"
            ]
        ]
        result["activeWindow"] = [
            "id": String(root.hashValue),
            "title": (stringAttribute(root, kAXTitleAttribute) ?? ""),
            "appName": app.localizedName ?? ""
        ]

        return result
    }

    guard request.command == "act", let payload = request.payload else {
        throw NSError(domain: "native-computer-mcp", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unsupported AX command."])
    }

    if let targetId = payload.targetId, targetId.hasPrefix("ax:") {
        let suffix = String(targetId.dropFirst(3))
        let path = suffix.isEmpty ? [] : suffix.split(separator: ".").compactMap { Int($0) }
        let element = try resolve(root, path: path)

        switch payload.type {
        case "click":
            if payload.button == "right" {
                guard let bounds = boundsAttribute(element) else {
                    throw NSError(domain: "native-computer-mcp", code: 4, userInfo: [NSLocalizedDescriptionKey: "AX target has no bounds."])
                }
                click(CGPoint(x: bounds.x + bounds.width / 2.0, y: bounds.y + bounds.height / 2.0), .right)
            } else if payload.button == "middle" {
                guard let bounds = boundsAttribute(element) else {
                    throw NSError(domain: "native-computer-mcp", code: 4, userInfo: [NSLocalizedDescriptionKey: "AX target has no bounds."])
                }
                click(CGPoint(x: bounds.x + bounds.width / 2.0, y: bounds.y + bounds.height / 2.0), .center)
            } else {
                try invoke(element)
            }
        case "set_value":
            try setValue(element, payload.value ?? "")
        case "secondary_action":
            try invokeSecondary(element)
        default:
            throw NSError(domain: "native-computer-mcp", code: 6, userInfo: [NSLocalizedDescriptionKey: "Unsupported AX semantic action."])
        }

        return ["ok": true]
    }

    switch payload.type {
    case "click":
        if let point = payload.point {
            let button: CGMouseButton = payload.button == "right" ? .right : payload.button == "middle" ? .center : .left
            click(CGPoint(x: point.x, y: point.y), button)
            return ["ok": true]
        }
    case "type":
        sendText(payload.text ?? "")
        return ["ok": true]
    case "key":
        try sendKey(payload.value ?? "", modifiers: payload.modifiers ?? [])
        return ["ok": true]
    case "scroll":
        sendScroll(payload.deltaX ?? 0, payload.deltaY ?? 0)
        return ["ok": true]
    case "drag":
        if let from = payload.from, let to = payload.to {
            sendDrag(CGPoint(x: from.x, y: from.y), CGPoint(x: to.x, y: to.y), payload.durationMs ?? 250)
            return ["ok": true]
        }
    default:
        break
    }

    throw NSError(domain: "native-computer-mcp", code: 7, userInfo: [NSLocalizedDescriptionKey: "Unsupported AX action."])
}

do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONDecoder().decode(Request.self, from: input)
    let response = try main(request)
    let data = try JSONSerialization.data(withJSONObject: response)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    let response: [String: Any] = ["ok": false, "message": error.localizedDescription]
    let data = try JSONSerialization.data(withJSONObject: response)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(1)
}
