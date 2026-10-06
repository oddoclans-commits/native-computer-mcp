import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { BaseComputerAdapter } from "./base.js";
import { commandExists, runCommand } from "./command.js";
import type { ActionRequest, ActionResult, Observation } from "../types.js";
import { tmpdir } from "node:os";

interface AxResponse {
  ok: boolean;
  message?: string;
  accessibility?: Observation["accessibility"];
  activeWindow?: Observation["activeWindow"];
  screenshot?: Observation["screenshot"];
  capabilities?: string[];
}

export class MacOSAXAdapter extends BaseComputerAdapter {
  readonly platform = "macos" as const;
  readonly name = "macos-ax-native";

  private binaryPath(): string {
    return join(process.cwd(), ".artifacts", "bin", "macos-ax");
  }

  async status() {
    const swiftc = await commandExists("swiftc");
    const helper = fileURLToPath(new URL("../../native/macos-ax.swift", import.meta.url));
    const trusted = process.platform === "darwin" ? "runtime-check" : "darwin-only";

    return {
      ready: process.platform === "darwin" && swiftc,
      capabilities:
        process.platform === "darwin" && swiftc
          ? [
              "native_input",
              "ui_automation",
              "semantic_targets",
              "semantic_actions",
              "accessibility_ax",
              "screenshot"
            ]
          : [],
      message:
        process.platform !== "darwin"
          ? "macOS Accessibility adapter can only run on macOS."
          : swiftc
            ? "macOS Accessibility adapter is available; Accessibility trust is checked on start."
            : "swiftc is required for the macOS AX helper.",
      details: { swiftc, helper, trusted }
    };
  }

  async start(): Promise<void> {
    const status = await this.status();
    if (!status.ready) throw new Error(status.message ?? "macOS AX backend unavailable.");

    await mkdir(dirname(this.binaryPath()), { recursive: true });
    const helper = fileURLToPath(new URL("../../native/macos-ax.swift", import.meta.url));
    const result = await runCommand(
      "swiftc",
      ["-O", helper, "-o", this.binaryPath()],
      { timeoutMs: 30_000 }
    );
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "Failed to compile macOS AX helper.");
    }
  }

  async observe(): Promise<Observation> {
    const response = await this.invoke("observe");
    if (!response.ok) {
      throw new Error(response.message ?? "macOS AX observation failed.");
    }

    const screenshot = await this.captureScreenshot();

    return {
      observationId: randomUUID(),
      timestamp: new Date().toISOString(),
      platform: this.platform,
      ...(response.activeWindow ? { activeWindow: response.activeWindow } : {}),
      displays: [],
      windows: [],
      ...(response.accessibility ? { accessibility: response.accessibility } : {}),
      ...(screenshot ? { screenshot } : {}),
      capabilities: [...new Set([
        ...(response.capabilities ?? []),
        ...(screenshot ? ["screenshot"] : [])
      ])]
    };
  }

  async act(request: ActionRequest): Promise<ActionResult> {
    try {
      const response = await this.invoke("act", request.action);
      return response.ok
        ? {
            status: "executed",
            verification: "needs_observation",
            nextObservationRequired: true,
            evidence: [`native:${this.name}`]
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

  async stop(): Promise<void> {}

  private async captureScreenshot(): Promise<Observation["screenshot"] | undefined> {
    const directory = await mkdtemp(join(tmpdir(), "native-computer-mcp-"));
    const path = join(directory, "screen.png");

    try {
      const result = await runCommand(
        "/usr/sbin/screencapture",
        ["-x", "-m", "-t", "png", path],
        { timeoutMs: 10_000 }
      );

      if (result.code !== 0) return undefined;

      const bytes = await readFile(path);
      if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) return undefined;

      const data = bytes.toString("base64");
      const hash = createHash("sha256").update(bytes).digest("hex");

      return {
        mimeType: "image/png",
        data,
        uri: `sha256:${hash}`
      };
    } catch {
      return undefined;
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async invoke(command: string, payload?: unknown): Promise<AxResponse> {
    const result = await runCommand(
      this.binaryPath(),
      [],
      {
        timeoutMs: command === "observe" ? 20_000 : 10_000,
        input: JSON.stringify({ command, payload: payload ?? null })
      }
    );

    if (result.code !== 0 && !result.stdout.trim()) {
      throw new Error(result.stderr.trim() || "macOS AX helper failed.");
    }

    return JSON.parse(result.stdout) as AxResponse;
  }
}
