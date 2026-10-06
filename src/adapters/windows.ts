import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { BaseComputerAdapter } from "./base.js";
import { runCommand } from "./command.js";
import type {
  ActionRequest,
  ActionResult,
  DisplayInfo,
  Observation,
  Platform,
  WindowInfo
} from "../types.js";

interface NativeResponse {
  ok: boolean;
  message?: string;
  observation?: Omit<Observation, "observationId" | "timestamp" | "platform">;
}

export class WindowsAdapter extends BaseComputerAdapter {
  readonly platform: Platform = "windows";
  readonly name = "windows-win32-native";

  async status() {
    if (process.platform !== "win32") {
      return {
        ready: false,
        capabilities: [],
        message: "Windows adapter can only run on Windows."
      };
    }

    return {
      ready: true,
      capabilities: [
        "native_input",
        "active_window",
        "window_discovery",
        "display_discovery",
        "screenshot"
      ],
      message: "Windows Win32 native backend is available."
    };
  }

  async start(): Promise<void> {
    const status = await this.status();
    if (!status.ready) throw new Error(status.message ?? "Windows backend unavailable.");
  }

  async observe(): Promise<Observation> {
    const response = await this.invoke("observe");
    if (!response.ok || !response.observation) {
      throw new Error(response.message ?? "Windows native observation failed.");
    }

    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      platform: this.platform,
      ...response.observation
    };
  }

  async act(request: ActionRequest): Promise<ActionResult> {
    try {
      const response = await this.invoke("act", request.action);
      if (!response.ok) {
        return {
          status: "uncertain",
          verification: "needs_observation",
          nextObservationRequired: true,
          message: response.message ?? "Native Windows action failed."
        };
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
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async stop(): Promise<void> {}

  private async invoke(command: string, payload?: unknown): Promise<NativeResponse> {
    const encoded = Buffer.from(
      JSON.stringify({ command, payload: payload ?? null }),
      "utf8"
    ).toString("base64");

    const script = new URL("../../native/windows-native.ps1", import.meta.url);
    const candidates = ["powershell.exe", "pwsh.exe"];

    let lastError: unknown;

    for (const executable of candidates) {
      try {
        const result = await runCommand(
          executable,
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            fileURLToPath(script),
            "-PayloadBase64",
            encoded
          ],
          { timeoutMs: 15_000 }
        );

        if (result.code !== 0) {
          throw new Error(result.stderr.trim() || "PowerShell helper failed.");
        }

        return JSON.parse(result.stdout) as NativeResponse;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("No PowerShell executable is available.");
  }
}
