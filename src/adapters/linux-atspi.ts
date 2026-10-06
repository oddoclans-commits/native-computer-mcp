import { fileURLToPath } from "node:url";
import { LinuxX11Adapter } from "./linux-x11.js";
import { BaseComputerAdapter } from "./base.js";
import { commandExists, runCommand } from "./command.js";
import type { ActionRequest, ActionResult, Observation } from "../types.js";

interface AtspiResponse {
  ok: boolean;
  message?: string;
  accessibility?: Observation["accessibility"];
  capabilities?: string[];
}

export class LinuxAtspiAdapter extends BaseComputerAdapter {
  readonly platform = "linux" as const;
  readonly name = "linux-atspi-native";
  private readonly x11 = new LinuxX11Adapter();

  async status() {
    const python = await commandExists("python3");
    const atspi = python && (await this.importAvailable());
    const x11 = await this.x11.status();

    const capabilities = [...(x11.capabilities ?? [])];
    if (atspi) {
      capabilities.push("ui_automation", "semantic_targets", "semantic_actions", "accessibility_atspi");
    }

    return {
      ready: x11.ready || atspi,
      capabilities: [...new Set(capabilities)],
      message:
        x11.ready && atspi
          ? "Linux X11 + AT-SPI native backend is available."
          : atspi
            ? "AT-SPI accessibility is available; native pointer input requires X11."
            : x11.ready
              ? "Linux X11 native backend is available; AT-SPI is not installed."
              : "Linux backend requires X11/xdotool or AT-SPI.",
      details: { python, atspi, x11: x11.ready }
    };
  }

  async start(): Promise<void> {
    const status = await this.status();
    if (!status.ready) throw new Error(status.message ?? "Linux backend unavailable.");
  }

  async observe(): Promise<Observation> {
    const status = await this.status();
    if (!status.ready) throw new Error(status.message ?? "Linux backend unavailable.");

    let base: Observation = {
      observationId: "",
      timestamp: new Date().toISOString(),
      platform: "linux",
      displays: [],
      windows: [],
      capabilities: []
    };

    if (status.details?.x11) {
      try {
        base = await this.x11.observe();
      } catch {
        // Keep AT-SPI-only observation.
      }
    }

    if (status.capabilities.includes("accessibility_atspi")) {
      const response = await this.invoke("observe");
      if (!response.ok) throw new Error(response.message ?? "AT-SPI observation failed.");
      base.accessibility = response.accessibility;
      base.capabilities = [...new Set([...base.capabilities, ...(response.capabilities ?? [])])];
    }

    return {
      ...base,
      observationId: (await import("node:crypto")).randomUUID(),
      timestamp: new Date().toISOString()
    };
  }

  async act(request: ActionRequest): Promise<ActionResult> {
    if (request.action.type === "click" && request.action.targetId?.startsWith("atspi:")) {
      return this.semanticAct(request.action);
    }
    if (
      request.action.type === "set_value" &&
      request.action.targetId.startsWith("atspi:")
    ) {
      return this.semanticAct(request.action);
    }
    if (
      request.action.type === "secondary_action" &&
      request.action.targetId.startsWith("atspi:")
    ) {
      return this.semanticAct(request.action);
    }

    const status = await this.x11.status();
    if (!status.ready) {
      return {
        status: "blocked",
        verification: "not_checked",
        nextObservationRequired: false,
        message: "Coordinate native input requires a ready Linux X11 backend."
      };
    }
    return this.x11.act(request);
  }

  async stop(): Promise<void> {}

  private async semanticAct(action: ActionRequest["action"]): Promise<ActionResult> {
    try {
      const response = await this.invoke("act", action);
      return response.ok
        ? {
            status: "executed",
            verification: "needs_observation",
            nextObservationRequired: true,
            evidence: ["native:linux-atspi-native"]
          }
        : {
            status: "uncertain",
            verification: "needs_observation",
            nextObservationRequired: true,
            message: response.message
          };
    } catch (error) {
      return {
        status: "uncertain",
        verification: "needs_observation",
        nextObservationRequired: true,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async invoke(command: string, payload?: unknown): Promise<AtspiResponse> {
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

  private async importAvailable(): Promise<boolean> {
    try {
      const result = await runCommand(
        "python3",
        ["-c", "import pyatspi"],
        { timeoutMs: 5_000 }
      );
      return result.code === 0;
    } catch {
      return false;
    }
  }
}
