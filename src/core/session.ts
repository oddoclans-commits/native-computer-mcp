import { randomUUID } from "node:crypto";
import { observationFingerprint } from "./verification.js";
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
}

export class SessionManager {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly observations = new Map<string, StoredObservation>();
  private readonly previousFingerprints = new Map<string, string>();

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
    if (previous) this.previousFingerprints.set(sessionId, previous.fingerprint);

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
      capabilities: [...observation.capabilities]
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
      capabilities: [...stored.capabilities]
    };
  }

  getPreviousFingerprint(sessionId: string): string | undefined {
    return this.previousFingerprints.get(sessionId);
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
    delete session.observationId;
    this.observations.delete(sessionId);
  }

  stop(sessionId: string): RuntimeSession {
    const session = this.get(sessionId);
    session.active = false;
    delete session.observationId;
    this.observations.delete(sessionId);
    this.previousFingerprints.delete(sessionId);
    return session;
  }
}
