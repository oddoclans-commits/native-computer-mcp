import { BaseComputerAdapter } from "./base.js";
import type {
  ActionRequest,
  ActionResult,
  Observation,
  Platform
} from "../types.js";

export class UnavailableAdapter extends BaseComputerAdapter {
  readonly platform: Platform = process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : process.platform === "linux"
        ? "linux"
        : "unknown";

  readonly name = "unavailable";

  async status() {
    return {
      ready: false,
      capabilities: [],
      message:
        "No native backend is installed yet. The protocol/runtime is operational, but platform control is not."
    };
  }

  async start(): Promise<void> {}

  async observe(): Promise<Observation> {
    throw new Error("No native computer adapter is installed.");
  }

  async act(_request: ActionRequest): Promise<ActionResult> {
    return {
      status: "blocked",
      verification: "not_checked",
      message: "No native computer adapter is installed."
    };
  }

  async stop(): Promise<void> {}
}
