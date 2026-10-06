import { randomUUID } from "node:crypto";
import { observationFingerprint } from "./verification.js";
import { screenshotFingerprint } from "./diff.js";
import type { AccessibilityNode, Observation, RuntimeSession } from "../types.js";

interface StoredObservation {
  observationId: string;
  fingerprint: string;
  platform: Observation["platform"];
  activeWindow?: Observation["activeWindow"];
  displays: Observation["displays"];
  windows: Observation["windows"];
  accessibility: AccessibilityNode[];
  capabilities: string[];
  timestamp: string;
  screenshot?: {
    sha256: string;
    mimeType: string;
    width?: number;
    height?: number;
  };
}

export class SessionManager {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly observations = new Map<string, StoredObservation>();
  private readonly previousFingerprints = new Map<string, string>();
  private readonly previousObservations = new Map<string, StoredObservation>();

  create(): RuntimeSession {
    const session: RuntimeSession = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      active: true
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): RuntimeSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown session: ${id}`);
    return session;
  }

  recordObservation(sessionId: string, observation: Observation): void {
    const session = this.get(sessionId);
    const previous = this.observations.get(sessionId);
    if (previous) {
      this.previousFingerprints.set(sessionId, previous.fingerprint);
      this.previousObservations.set(sessionId, structuredClone(previous));
    }

    session.observationId = observation.observationId;
    this.observations.set(sessionId, {
      observationId: observation.observationId,
      fingerprint: observationFingerprint(observation),
      ...(observation.activeWindow ? { activeWindow: structuredClone(observation.activeWindow) } : {}),
      platform: observation.platform,
      displays: structuredClone(observation.displays),
      windows: structuredClone(observation.windows),
      accessibility: observation.accessibility
        ? structuredClone(observation.accessibility)
        : [],
      capabilities: [...observation.capabilities],
      timestamp: observation.timestamp,
      ...(screenshotFingerprint(observation)
        ? {
            screenshot: {
              sha256: screenshotFingerprint(observation)!.sha256,
              mimeType: observation.screenshot?.mimeType ?? "application/octet-stream",
              ...(observation.screenshot?.width !== undefined
                ? { width: observation.screenshot.width }
                : {}),
              ...(observation.screenshot?.height !== undefined
                ? { height: observation.screenshot.height }
                : {})
            }
          }
        : {})
    });
  }

  getAccessibility(sessionId: string, observationId: string): AccessibilityNode[] {
    return structuredClone(this.getObservation(sessionId, observationId).accessibility ?? []);
  }

  getObservation(sessionId: string, observationId: string): Observation {
    this.assertFreshObservation(sessionId, observationId);
    const stored = this.observations.get(sessionId);
    if (!stored) throw new Error("Observation is not available.");

    return {
      observationId: stored.observationId,
      timestamp: new Date().toISOString(),
      platform: stored.platform,
      ...(stored.activeWindow ? { activeWindow: structuredClone(stored.activeWindow) } : {}),
      displays: structuredClone(stored.displays),
      windows: structuredClone(stored.windows),
      accessibility: structuredClone(stored.accessibility),
      capabilities: [...stored.capabilities],
      ...(stored.screenshot
        ? {
            screenshot: {
              mimeType: stored.screenshot.mimeType,
              uri: "sha256:" + stored.screenshot.sha256,
              ...(stored.screenshot.width !== undefined
                ? { width: stored.screenshot.width }
                : {}),
              ...(stored.screenshot.height !== undefined
                ? { height: stored.screenshot.height }
                : {})
            }
          }
        : {})
    };
  }

  getPreviousFingerprint(sessionId: string): string | undefined {
    return this.previousFingerprints.get(sessionId);
  }

  getPreviousObservation(sessionId: string): Observation | undefined {
    const stored = this.previousObservations.get(sessionId);
    if (!stored) return undefined;

    return {
      observationId: stored.observationId,
      timestamp: stored.timestamp,
      platform: stored.platform,
      ...(stored.activeWindow ? { activeWindow: structuredClone(stored.activeWindow) } : {}),
      displays: structuredClone(stored.displays),
      windows: structuredClone(stored.windows),
      accessibility: structuredClone(stored.accessibility),
      capabilities: [...stored.capabilities],
      ...(stored.screenshot
        ? {
            screenshot: {
              mimeType: stored.screenshot.mimeType,
              uri: "sha256:" + stored.screenshot.sha256,
              ...(stored.screenshot.width !== undefined
                ? { width: stored.screenshot.width }
                : {}),
              ...(stored.screenshot.height !== undefined
                ? { height: stored.screenshot.height }
                : {})
            }
          }
        : {})
    };
  }

  assertFreshObservation(sessionId: string, observationId?: string): void {
    if (!observationId) throw new Error("A fresh observation_id is required before acting.");
    const session = this.get(sessionId);
    if (session.observationId !== observationId) {
      throw new Error(
        "The observation is stale, already consumed, or belongs to another session. Observe again before acting."
      );
    }
  }

  consumeObservation(sessionId: string): void {
    const session = this.get(sessionId);
    const current = this.observations.get(sessionId);

    if (current) {
      this.previousFingerprints.set(sessionId, current.fingerprint);
      this.previousObservations.set(sessionId, structuredClone(current));
    }

    delete session.observationId;
    this.observations.delete(sessionId);
  }

  stop(sessionId: string): RuntimeSession {
    const session = this.get(sessionId);
    session.active = false;
    delete session.observationId;
    this.observations.delete(sessionId);
    this.previousFingerprints.delete(sessionId);
    this.previousObservations.delete(sessionId);
    return session;
  }
}
