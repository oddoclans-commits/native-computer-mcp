import { SessionManager } from "./session.js";
import { findAccessibilityNodes, type AccessibilityMatch } from "./query.js";
import type {
  ComputerAdapter,
  Observation,
  ActionRequest,
  ActionResult,
  Action,
  RiskTier,
  SafetyMode
} from "../types.js";

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

  find(
    sessionId: string,
    observationId: string,
    query: string,
    role?: string
  ): AccessibilityMatch[] {
    const session = this.sessions.get(sessionId);
    if (!session.active) throw new Error("Session is not active.");

    const roots = this.sessions.getAccessibility(sessionId, observationId);
    return findAccessibilityNodes(roots, query, role);
  }

  async act(sessionId: string, request: ActionRequest): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);

    if (!session.active) {
      throw new Error("Session is not active.");
    }

    this.sessions.assertFreshObservation(sessionId, request.observationId);

    const safety = evaluateSafety(request.action, request.risk, request.safetyMode);
    if (!safety.allowed) {
      return {
        status: "blocked",
        verification: "not_checked",
        nextObservationRequired: false,
        message: safety.message
      };
    }

    const result = await this.adapter.act({
      ...request,
      risk: safety.risk
    });

    if (result.status === "executed" || result.status === "uncertain") {
      this.sessions.consumeObservation(sessionId);
    }

    return result;
  }

  async stop(sessionId: string) {
    await this.adapter.stop();
    return this.sessions.stop(sessionId);
  }
}

function evaluateSafety(
  action: Action,
  requestedRisk?: RiskTier,
  mode: SafetyMode = "auto"
): { allowed: boolean; risk: RiskTier; message?: string } {
  const inferred = inferRisk(action);
  const risk = maxRisk(inferred, requestedRisk ?? "safe");

  if (mode === "auto" || risk === "safe") {
    return { allowed: true, risk };
  }

  return {
    allowed: false,
    risk,
    message:
      mode === "ask"
        ? `Approval required for ${risk} action: ${action.type}.`
        : `Action denied by safety mode: ${risk} action ${action.type}.`
  };
}

function inferRisk(action: Action): RiskTier {
  switch (action.type) {
    case "click":
    case "scroll":
    case "drag":
      return "safe";
    case "type":
    case "key":
    case "activate_window":
    case "set_value":
    case "secondary_action":
      return "sensitive";
  }
}

function maxRisk(left: RiskTier, right: RiskTier): RiskTier {
  const rank: Record<RiskTier, number> = {
    safe: 0,
    sensitive: 1,
    dangerous: 2
  };

  return rank[left] >= rank[right] ? left : right;
}
