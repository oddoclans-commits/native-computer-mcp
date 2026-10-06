import { SessionManager } from "./session.js";
import type { ComputerAdapter, Observation, ActionRequest, ActionResult } from "../types.js";

export class ComputerRuntime {
  readonly sessions = new SessionManager();

  constructor(private readonly adapter: ComputerAdapter) {}

  async status() {
    return {
      adapter: this.adapter.name,
      platform: this.adapter.platform,
      ...(await this.adapter.status())
    };
  }

  async start() {
    await this.adapter.start();
    return this.sessions.create();
  }

  async observe(sessionId: string): Promise<Observation> {
    const session = this.sessions.get(sessionId);

    if (!session.active) {
      throw new Error("Session is not active.");
    }

    const observation = await this.adapter.observe();
    this.sessions.recordObservation(sessionId, observation);
    return observation;
  }

  async act(sessionId: string, request: ActionRequest): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);

    if (!session.active) {
      throw new Error("Session is not active.");
    }

    this.sessions.assertFreshObservation(sessionId, request.observationId);
    return this.adapter.act(request);
  }

  async stop(sessionId: string) {
    await this.adapter.stop();
    return this.sessions.stop(sessionId);
  }
}
