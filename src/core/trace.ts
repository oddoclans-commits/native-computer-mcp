import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ActionRequest, ActionResult, Observation, VerificationResult } from "../types.js";

export type TraceEventKind =
  | "session_start"
  | "observe"
  | "act"
  | "verify"
  | "dialog"
  | "session_stop";

export interface TraceEvent {
  id: string;
  kind: TraceEventKind;
  sessionId: string;
  timestamp: string;
  observationId?: string;
  payload: Record<string, unknown>;
  artifacts?: string[];
}

export interface ArtifactSink {
  writeText(path: string, content: string): Promise<string>;
  writeBytes(path: string, data: Buffer): Promise<string>;
}

export class FileArtifactSink implements ArtifactSink {
  constructor(private readonly root = join(process.cwd(), ".artifacts")) {}

  private async write(path: string, data: string | Buffer): Promise<string> {
    const relative = path
      .replace(/^[/\\\\]+/, "")
      .replace(/\\.\\.(?:[/\\\\]|$)/g, "");
    const target = join(this.root, relative);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, data);
    return target;
  }

  async writeText(path: string, content: string): Promise<string> {
    return this.write(path, content);
  }

  async writeBytes(path: string, data: Buffer): Promise<string> {
    return this.write(path, data);
  }
}

export class FileTraceSink {
  constructor(
    private readonly artifacts: ArtifactSink = new FileArtifactSink()
  ) {}

  async record(event: TraceEvent): Promise<string[]> {
    const eventPath = join(
      "computer-trace",
      event.sessionId,
      String(event.timestamp).replace(/[:.]/g, "-") + "-" + event.id + ".json"
    );

    return [await this.artifacts.writeText(eventPath, JSON.stringify(event, null, 2))];
  }

  async observation(sessionId: string, observation: Observation): Promise<string[]> {
    const event: TraceEvent = {
      id: randomUUID(),
      kind: "observe",
      sessionId,
      timestamp: observation.timestamp,
      observationId: observation.observationId,
      payload: {
        platform: observation.platform,
        activeWindow: observation.activeWindow,
        displays: observation.displays,
        windows: observation.windows,
        accessibility: observation.accessibility,
        capabilities: observation.capabilities
      }
    };

    const artifacts: string[] = [];
    if (observation.screenshot?.data) {
      const bytes = Buffer.from(observation.screenshot.data, "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const extension = observation.screenshot.mimeType === "image/png" ? "png" : "bin";
      artifacts.push(
        await this.artifacts.writeBytes(
          join("computer-trace", sessionId, "screenshots", hash + "." + extension),
          bytes
        )
      );
    }

    event.artifacts = artifacts.length ? artifacts : undefined;
    return [
      await this.artifacts.writeText(
        join(
          "computer-trace",
          sessionId,
          String(observation.timestamp).replace(/[:.]/g, "-") + "-observe.json"
        ),
        JSON.stringify(event, null, 2)
      ),
      ...artifacts
    ];
  }

  async action(
    sessionId: string,
    request: ActionRequest,
    result: ActionResult
  ): Promise<string[]> {
    return this.record({
      id: randomUUID(),
      kind: "act",
      sessionId,
      timestamp: new Date().toISOString(),
      observationId: request.observationId,
      payload: {
        action: redactAction(request),
        result
      }
    });
  }

  async verify(
    sessionId: string,
    observationId: string,
    result: VerificationResult
  ): Promise<string[]> {
    return this.record({
      id: randomUUID(),
      kind: "verify",
      sessionId,
      timestamp: new Date().toISOString(),
      observationId,
      payload: { result }
    });
  }
}

function redactAction(request: ActionRequest): Record<string, unknown> {
  const action = request.action;
  if (action.type === "type") {
    return {
      type: action.type,
      text: "[REDACTED]",
      textLength: action.text.length
    };
  }
  if (action.type === "set_value") {
    return {
      type: action.type,
      targetId: action.targetId,
      value: "[REDACTED]"
    };
  }
  return action;
}
