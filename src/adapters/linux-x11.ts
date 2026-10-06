import { randomUUID, createHash } from "node:crypto";
import { BaseComputerAdapter } from "./base.js";
import { commandExists, runCommand } from "./command.js";
import type {
  ActionRequest,
  ActionResult,
  DisplayInfo,
  Observation,
  Platform,
  Rect,
  WindowInfo
} from "../types.js";

export class LinuxX11Adapter extends BaseComputerAdapter {
  readonly platform: Platform = "linux";
  readonly name = "linux-x11-native";

  private async tools() {
    const [xdotool, wmctrl, xrandr, importTool] = await Promise.all([
      commandExists("xdotool"),
      commandExists("wmctrl"),
      commandExists("xrandr"),
      commandExists("import")
    ]);

    return { xdotool, wmctrl, xrandr, importTool };
  }

  async status() {
    const capabilities: string[] = [];
    const tools = await this.tools();
    const display = Boolean(process.env.DISPLAY);

    if (tools.xdotool && display) capabilities.push("native_input", "active_window");
    if (tools.wmctrl && display) capabilities.push("window_discovery");
    if (tools.xrandr && display) capabilities.push("display_discovery");
    if (tools.importTool && display) capabilities.push("screenshot");

    const ready = display && tools.xdotool;

    return {
      ready,
      capabilities,
      message: ready
        ? "Linux X11 native computer backend is available."
        : "Linux X11 backend requires DISPLAY and xdotool.",
      details: {
        display,
        tools
      }
    };
  }

  async start(): Promise<void> {
    const status = await this.status();
    if (!status.ready) {
      throw new Error(status.message ?? "Linux X11 backend is unavailable.");
    }
  }

  async observe(): Promise<Observation> {
    const status = await this.status();
    if (!status.ready) {
      throw new Error(status.message ?? "Linux X11 backend is unavailable.");
    }

    const [activeWindow, windows, displays, screenshot] = await Promise.all([
      this.getActiveWindow(),
      this.getWindows(),
      this.getDisplays(),
      this.getScreenshot()
    ]);

    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      platform: this.platform,
      ...(activeWindow ? { activeWindow } : {}),
      displays,
      windows,
      ...(screenshot ? { screenshot } : {}),
      capabilities: status.capabilities
    };
  }

  async act(request: ActionRequest): Promise<ActionResult> {
    const action = request.action;

    try {
      switch (action.type) {
        case "click":
          await this.click(action.point.x, action.point.y, action.button ?? "left");
          break;
        case "type":
          await this.runXdotool(["type", "--clearmodifiers", "--delay", "1", action.text]);
          break;
        case "key": {
          const key = [...(action.modifiers ?? []), action.key].join("+");
          await this.runXdotool(["key", key]);
          break;
        }
        case "scroll": {
          const delta = action.deltaY ?? 0;
          if (delta === 0) break;
          const clicks = Math.max(1, Math.ceil(Math.abs(delta) / 120));
          await this.runXdotool([
            "click",
            "--repeat",
            String(clicks),
            delta > 0 ? "4" : "5"
          ]);
          break;
        }
        case "drag":
          await this.runXdotool(["mousemove", "--sync", String(action.from.x), String(action.from.y)]);
          await this.runXdotool(["mousedown", "1"]);
          await this.runXdotool([
            "mousemove",
            "--sync",
            "--delay",
            String(Math.max(1, Math.round((action.durationMs ?? 250) / 10))),
            String(action.to.x),
            String(action.to.y)
          ]);
          await this.runXdotool(["mouseup", "1"]);
          break;
        case "set_value":
        case "secondary_action":
          return {
            status: "blocked",
            verification: "needs_observation",
            nextObservationRequired: true,
            message: `Action ${action.type} needs an accessibility-aware implementation in the Linux adapter.`
          };
        case "activate_window":
          await this.runCommand("wmctrl", ["-ia", action.windowId]);
          break;
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

  private async click(x: number, y: number, button: "left" | "middle" | "right") {
    const map = { left: "1", middle: "2", right: "3" } as const;
    await this.runXdotool(["mousemove", "--sync", String(x), String(y)]);
    await this.runXdotool(["click", map[button]]);
  }

  private async runXdotool(args: string[]) {
    return this.runCommand("xdotool", args);
  }

  private async runCommand(command: string, args: string[]) {
    const result = await runCommand(command, args);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `${command} exited with code ${result.code}`);
    }
    return result.stdout;
  }

  private async getActiveWindow(): Promise<WindowInfo | undefined> {
    try {
      const id = (await this.runCommand("xdotool", ["getactivewindow"])).trim();
      if (!id) return undefined;

      const title = (await this.runCommand("xdotool", ["getwindowname", id])).trim();
      const geometry = (await this.runCommand("xdotool", ["getwindowgeometry", "--shell", id])).trim();
      const bounds = parseShellGeometry(geometry);

      return {
        id,
        ...(title ? { title } : {}),
        ...(bounds ? { bounds } : {}),
        focused: true
      };
    } catch {
      return undefined;
    }
  }

  private async getWindows(): Promise<WindowInfo[]> {
    const status = await this.status();
    if (!status.capabilities.includes("window_discovery")) return [];

    try {
      const raw = await this.runCommand("wmctrl", ["-lG"]);
      return raw
        .split("\n")
        .map(parseWmctrlLine)
        .filter((value): value is WindowInfo => value !== undefined);
    } catch {
      return [];
    }
  }

  private async getDisplays(): Promise<DisplayInfo[]> {
    const status = await this.status();
    if (!status.capabilities.includes("display_discovery")) return [];

    try {
      const raw = await this.runCommand("xrandr", ["--current", "--query"]);
      return raw
        .split("\n")
        .map((line) => {
          const match = line.match(/^([^\s]+) connected(?: primary)? (\d+)x(\d+)\+(-?\d+)\+(-?\d+)/);
          if (!match) return undefined;
          return {
            id: match[1],
            bounds: {
              x: Number(match[4]),
              y: Number(match[5]),
              width: Number(match[2]),
              height: Number(match[3])
            }
          };
        })
        .filter((value): value is DisplayInfo => value !== undefined);
    } catch {
      return [];
    }
  }

  private async getScreenshot(): Promise<Observation["screenshot"] | undefined> {
    const status = await this.status();
    if (!status.capabilities.includes("screenshot")) return undefined;

    try {
      const result = await runCommand("import", ["-window", "root", "png:-"], {
        timeoutMs: 10_000
      });
      if (result.code !== 0 || !result.stdout) return undefined;

      const bytes = Buffer.from(result.stdout, "binary");
      const data = bytes.toString("base64");
      const hash = createHash("sha256").update(bytes).digest("hex");

      if (bytes.length > 8 * 1024 * 1024) return undefined;

      return {
        mimeType: "image/png",
        data,
        uri: `sha256:${hash}`
      };
    } catch {
      return undefined;
    }
  }
}

function parseShellGeometry(raw: string): Rect | undefined {
  const values = Object.fromEntries(
    raw.split("\n")
      .map((line) => line.split("="))
      .filter((parts): parts is [string, string] => parts.length === 2)
  );

  if (!values.X || !values.Y || !values.WIDTH || !values.HEIGHT) return undefined;

  return {
    x: Number(values.X),
    y: Number(values.Y),
    width: Number(values.WIDTH),
    height: Number(values.HEIGHT)
  };
}

function parseWmctrlLine(line: string): WindowInfo | undefined {
  const match = line.match(/^(\S+)\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s+(.*)$/);
  if (!match) return undefined;

  return {
    id: match[1],
    bounds: {
      x: Number(match[3]),
      y: Number(match[4]),
      width: Number(match[5]),
      height: Number(match[6])
    },
    title: match[7]
  };
}
