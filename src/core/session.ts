import { randomUUID } from "node:crypto";
import type { AccessibilityNode, Observation, RuntimeSession } from "../types.js";

export class SessionManager {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly accessibilityBySession = new Map<string, AccessibilityNode[]>();

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
    session.observationId = observation.observationId;
    this.accessibilityBySession.set(
      sessionId,
      observation.accessibility ? structuredClone(observation.accessibility) : []
    );
  }

  getAccessibility(sessionId: string, observationId: string): AccessibilityNode[] {
    this.assertFreshObservation(sessionId, observationId);
    return structuredClone(this.accessibilityBySession.get(sessionId) ?? []);
  }

  assertFreshObservation(sessionId: string, observationId?: string): void {
    if (!observationId) {
      throw new Error("A fresh observation_id is required before acting.");
    }
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
    this.accessibilityBySession.delete(sessionId);
  }

  stop(sessionId: string): RuntimeSession {
    const session = this.get(sessionId);
    session.active = false;
    delete session.observationId;
    this.accessibilityBySession.delete(sessionId);
    return session;
  }
}
