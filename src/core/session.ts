import { randomUUID } from "node:crypto";
import type { Observation, RuntimeSession } from "../types.js";

export class SessionManager {
  private readonly sessions = new Map<string, RuntimeSession>();

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

    if (!session) {
      throw new Error(`Unknown session: ${id}`);
    }

    return session;
  }

  recordObservation(sessionId: string, observation: Observation): void {
    const session = this.get(sessionId);
    session.observationId = observation.observationId;
  }

  assertFreshObservation(sessionId: string, observationId?: string): void {
    if (!observationId) {
      throw new Error("A fresh observation_id is required before acting.");
    }

    const session = this.get(sessionId);

    if (session.observationId !== observationId) {
      throw new Error(
        "The observation is stale or belongs to another session. Observe again before acting."
      );
    }
  }

  stop(sessionId: string): RuntimeSession {
    const session = this.get(sessionId);
    session.active = false;
    return session;
  }
}
