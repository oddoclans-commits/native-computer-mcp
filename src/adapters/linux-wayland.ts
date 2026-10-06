import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { BaseComputerAdapter } from "./base.js";
import { commandExists, runCommand } from "./command.js";
import type { ActionRequest, ActionResult, Observation, Platform, Rect } from "../types.js";

interface AtspiResponse {
  ok: boolean;
  message?: string;
  accessibility?: Observation["accessibility"];
  capabilities?: string[];
}

export class LinuxWaylandAdapter extends BaseComputerAdapter {
  readonly platform: Platform = "linux";
  readonly name = "linux-wayland-native";

  async status() {
    const [atspi, ydotool, wtype, grim] = await Promise.all([
      this.importAvailable("pyatspi"),
      commandExists("ydotool"),
      commandExists("wtype"),
      commandExists("grim")
    ]);
    const wayland = Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland");
    const capabilities: string[] = [];

    if (wayland && ydotool) {
      capabilities.push("native_input", "pointer_input", "keyboard_input", "scroll_input");
    } else if (wayland && wtype) {
      capabilities.push("keyboard_input");
    }
    if (wayland && grim) capabilities.push("screenshot");
    if (atspi) {
      capabilities.push("ui_automation", "semantic_targets", "semantic_actions", "accessibility_atspi");
    }

    const ready = wayland && (atspi || ydotool || wtype);
    return {
      ready,
      capabilities: [...new Set(capabilities)],
      message: ready
        ? "Linux Wayland native backend is available."
        : "Linux Wayland backend requires a Wayland session plus wtype, ydotool, grim, or AT-SPI.",
      details: { wayland, atspi, ydotool, wtype, grim }
    };
  }

  async start(): Promise<void> {
    const status = await this.status();
    if (!status.ready) throw new Error(status.message ?? "Linux Wayland backend unavailable.");
  }

  async observe(): Promise<Observation> {
    const status = await this.status();
    if (!status.ready) throw new Error(status.message ?? "Linux Wayland backend unavailable.");

    const accessibility = status.capabilities.includes("accessibility_atspi")
      ? await this.observeAccessibility()
      : undefined;
    const screenshot = status.capabilities.includes("screenshot")
      ? await this.getScreenshot()
      : undefined;

    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      platform: "linux",
      displays: [],
      windows: [],
      ...(accessibility ? { accessibility } : {}),
      ...(screenshot ? { screenshot } : {}),
      capabilities: status.capabilities
    };
  }

  async act(request: ActionRequest): Promise<ActionResult> {
    try {
      const action = request.action;

      if (action.type === "click" && action.targetId?.startsWith("atspi:")) {
        return await this.semanticAct(action);
      }
      if (action.type === "set_value" && action.targetId.startsWith("atspi:")) {
        return await this.semanticAct(action);
      }
      if (action.type === "secondary_action" && action.targetId.startsWith("atspi:")) {
        return await this.semanticAct(action);
      }

      switch (action.type) {
        case "click":
          if (!action.point) throw new Error("Wayland coordinate click requires a point.");
          await this.pointerClick(action.point.x, action.point.y, action.button ?? "left");
          break;
        case "type":
          await this.typeText(action.text);
          break;
        case "key":
          await this.key(action.key, action.modifiers ?? []);
          break;
        case "scroll":
          await this.scroll(action.deltaX ?? 0, action.deltaY);
          break;
        case "drag":
          await this.drag(action.from, action.to, action.durationMs ?? 250);
          break;
        case "activate_window":
          throw new Error("Wayland window activation is compositor-specific and not implemented.");
        case "set_value":
        case "secondary_action":
          throw new Error("Wayland semantic action requires an AT-SPI targetId.");
      }

      return {
        status: "executed",
        verification: "needs_observation",
        nextObservationRequired: true,
        evidence: [`native:${this.name}`]
      };
    } catch (error) {
      return {
        status: "uncertain",
        verification: "needs_observation",
        nextObservationRequired: true,
        message: error instanceof Error ? error.message : String(error),
        evidence: [`native:${this.name}`]
      };
    }
  }

  async stop(): Promise<void> {}

  private async semanticAct(
    action: Extract<
      ActionRequest["action"],
      { type: "click" | "set_value" | "secondary_action" }
    > & { targetId: string }
  ): Promise<ActionResult> {
    if (!action.targetId?.startsWith("atspi:")) {
      throw new Error("AT-SPI semantic actions require an atspi: targetId.");
    }

    const response = await this.invokeAtspi("act", action);
    return response.ok
      ? {
          status: "executed",
          verification: "needs_observation",
          nextObservationRequired: true,
          evidence: [`native:${this.name}`, "semantic:atspi"]
        }
      : {
          status: "uncertain",
          verification: "needs_observation",
          nextObservationRequired: true,
          message: response.message,
          evidence: [`native:${this.name}`, "semantic:atspi"]
        };
  }

  private async observeAccessibility(): Promise<Observation["accessibility"]> {
    const response = await this.invokeAtspi("observe");
    if (!response.ok) throw new Error(response.message ?? "AT-SPI observation failed.");
    return response.accessibility ?? [];
  }

  private async pointerClick(x: number, y: number, button: "left" | "middle" | "right") {
    await this.requireTool("ydotool", "Wayland pointer input requires ydotool/ydotoold.");
    const buttons = { left: "0xC0", right: "0xC1", middle: "0xC2" } as const;
    await this.run("ydotool", ["mousemove", "--absolute", String(Math.round(x)), String(Math.round(y))]);
    await this.run("ydotool", ["click", buttons[button]]);
  }

  private async typeText(value: string) {
    if (await commandExists("wtype")) {
      await this.run("wtype", ["-"], value);
      return;
    }
    await this.requireTool("ydotool", "Wayland text input requires wtype or ydotool.");
    await this.run("ydotool", ["type", value]);
  }

  private async key(key: string, modifiers: string[]) {
    if (await commandExists("wtype")) {
      const args: string[] = [];
      for (const modifier of modifiers) args.push("-M", normalizeWtypeKey(modifier));
      args.push("-k", normalizeWtypeKey(key));
      for (const modifier of [...modifiers].reverse()) args.push("-m", normalizeWtypeKey(modifier));
      await this.run("wtype", args);
      return;
    }
    await this.requireTool("ydotool", "Wayland keyboard input requires wtype or ydotool.");
    throw new Error("ydotool key fallback requires physical Linux keycodes; use wtype for semantic key names.");
  }

  private async scroll(deltaX: number, deltaY: number) {
    await this.requireTool("ydotool", "Wayland coordinate scrolling requires ydotool.");
    const x = Math.round(deltaX);
    const y = Math.round(deltaY);
    if (x === 0 && y === 0) return;
    await this.run("ydotool", [
      "mousemove",
      "--wheel",
      "--xpos",
      String(x),
      "--ypos",
      String(-y)
    ]);
  }

  private async drag(from: { x: number; y: number }, to: { x: number; y: number }, durationMs: number) {
    await this.requireTool("ydotool", "Wayland drag requires ydotool.");
    await this.run("ydotool", [
      "mousemove",
      "--absolute",
      String(Math.round(from.x)),
      String(Math.round(from.y))
    ]);
    await this.run("ydotool", ["click", "0x40"]);

    const steps = Math.max(2, Math.min(30, Math.ceil(durationMs / 20)));
    for (let index = 1; index <= steps; index++) {
      const t = index / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      await this.run("ydotool", [
        "mousemove",
        "--absolute",
        String(Math.round(x)),
        String(Math.round(y))
      ]);
    }

    await this.run("ydotool", ["click", "0x80"]);
  }

  private async getScreenshot(): Promise<Observation["screenshot"] | undefined> {
    const directory = await mkdtemp(join(tmpdir(), "native-computer-mcp-"));
    const path = join(directory, "screen.png");

    try {
      const result = await runCommand("grim", [path], { timeoutMs: 10_000 });
      if (result.code !== 0) return undefined;

      const bytes = await readFile(path);
      if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) return undefined;

      const data = bytes.toString("base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const size = pngDimensions(bytes);

      return {
        mimeType: "image/png",
        data,
        uri: `sha256:${hash}`,
        ...(size ? { width: size.width, height: size.height } : {})
      };
    } catch {
      return undefined;
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async invokeAtspi(command: string, payload?: unknown): Promise<AtspiResponse> {
    const helper = fileURLToPath(new URL("../../native/linux-atspi.py", import.meta.url));
    const result = await runCommand(
      "python3",
      [helper, JSON.stringify({ command, payload: payload ?? null })],
      { timeoutMs: command === "observe" ? 20_000 : 10_000 }
    );

    if (result.code !== 0 && !result.stdout) {
      throw new Error(result.stderr.trim() || "AT-SPI helper failed.");
    }
    return JSON.parse(result.stdout) as AtspiResponse;
  }

  private async importAvailable(module: string): Promise<boolean> {
    try {
      const result = await runCommand("python3", ["-c", `import ${module}`], { timeoutMs: 5_000 });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  private async requireTool(tool: string, message: string) {
    if (!(await commandExists(tool))) throw new Error(message);
  }

  private async run(command: string, args: string[], input?: string) {
    const result = await runCommand(command, args, {
      timeoutMs: 30_000,
      ...(input !== undefined ? { input } : {})
    });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `${command} exited with code ${result.code}`);
    }
    return result.stdout;
  }
}

function normalizeWtypeKey(value: string): string {
  const key = value.trim();
  const map: Record<string, string> = {
    control: "ctrl",
    command: "logo",
    meta: "logo",
    super: "logo",
    windows: "win",
    return: "Return",
    enter: "Return",
    esc: "Escape",
    spacebar: "space",
    page_up: "Page_Up",
    page_down: "Page_Down",
    arrow_left: "Left",
    arrow_right: "Right",
    arrow_up: "Up",
    arrow_down: "Down"
  };
  return map[key.toLowerCase()] ?? key;
}

function pngDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(12) !== 0x49484452) {
    return undefined;
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  };
}
