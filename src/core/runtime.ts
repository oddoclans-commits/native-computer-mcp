import { randomUUID } from "node:crypto";
import { SessionManager } from "./session.js";
import { verifyObservation, type VerificationSpec } from "./verification.js";
import { observationDiff } from "./diff.js";
import { FileTraceSink } from "./trace.js";
import { findAccessibilityNodes, type AccessibilityMatch } from "./query.js";
import type {
  ComputerAdapter,
  Observation,
  ActionRequest,
  ActionResult,
  Action,
  RiskTier,
  SafetyMode,
  DialogAdapter,
  VerificationResult,
  ObservationDiff
} from "../types.js";

export class ComputerRuntime {
  readonly sessions = new SessionManager();

  constructor(
    private readonly adapter: ComputerAdapter,
    private readonly trace = new FileTraceSink()
  ) {}

  async status() {
    return {
      adapter: this.adapter.name,
      platform: this.adapter.platform,
      ...(await this.adapter.status())
    };
  }

  async start() {
    await this.adapter.start();
    const session = this.sessions.create();

    await this.trace.record({
      id: randomUUID(),
      kind: "session_start",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      payload: {}
    }).catch(() => []);

    return session;
  }

  async observe(sessionId: string): Promise<Observation> {
    const session = this.sessions.get(sessionId);
    if (!session.active) throw new Error("Session is not active.");

    const observation = await this.adapter.observe();
    this.sessions.recordObservation(sessionId, observation);
    await this.trace.observation(sessionId, observation).catch(() => []);
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

  verify(
    sessionId: string,
    observationId: string,
    spec: VerificationSpec = {}
  ): VerificationResult {
    const session = this.sessions.get(sessionId);
    if (!session.active) throw new Error("Session is not active.");

    const observation = this.sessions.getObservation(sessionId, observationId);
    const result = verifyObservation(
      observation,
      this.sessions.getPreviousObservation(sessionId),
      spec
    );
    void this.trace.verify(sessionId, observationId, result).catch(() => []);
    return result;
  }

  diff(sessionId: string, observationId: string): ObservationDiff {
    const session = this.sessions.get(sessionId);
    if (!session.active) throw new Error("Session is not active.");

    const observation = this.sessions.getObservation(sessionId, observationId);
    return observationDiff(
      this.sessions.getPreviousObservation(sessionId),
      observation
    );
  }

  async selectFile(
    sessionId: string,
    observationId: string,
    path: string
  ): Promise<ActionResult> {
    return this.runDialogAction(sessionId, observationId, (dialogs) =>
      dialogs.selectFile(path)
    );
  }

  async selectFolder(
    sessionId: string,
    observationId: string,
    path: string
  ): Promise<ActionResult> {
    return this.runDialogAction(sessionId, observationId, (dialogs) =>
      dialogs.selectFolder(path)
    );
  }

  async setSavePath(
    sessionId: string,
    observationId: string,
    path: string
  ): Promise<ActionResult> {
    return this.runDialogAction(sessionId, observationId, (dialogs) =>
      dialogs.setSavePath(path)
    );
  }

  private async runDialogAction(
    sessionId: string,
    observationId: string,
    operation: (dialogs: DialogAdapter) => Promise<ActionResult>
  ): Promise<ActionResult> {
    const dialogs = this.adapter.dialogs;
    if (!dialogs) {
      return {
        status: "blocked",
        verification: "not_checked",
        nextObservationRequired: false,
        message: "This platform does not expose a native dialog adapter."
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session.active) throw new Error("Session is not active.");
    this.sessions.assertFreshObservation(sessionId, observationId);

    const result = await operation(dialogs);
    await this.trace.record({
      id: randomUUID(),
      kind: "dialog",
      sessionId,
      timestamp: new Date().toISOString(),
      observationId,
      payload: { result }
    }).catch(() => []);

    if (result.status === "executed" || result.status === "uncertain") {
      this.sessions.consumeObservation(sessionId);
    }

    return result;
  }

  async act(sessionId: string, request: ActionRequest): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session.active) throw new Error("Session is not active.");

    this.sessions.assertFreshObservation(sessionId, request.observationId);
    const actionId = randomUUID();

    const safety = evaluateSafety(request.action, request.risk, request.safetyMode);
    if (!safety.allowed) {
      const result: ActionResult = {
        status: "blocked",
        verification: "not_checked",
        nextObservationRequired: false,
        message: safety.message,
        traceId: actionId,
        evidence: ["trace:" + actionId]
      };
      await this.trace.action(sessionId, request, result, actionId).catch(() => []);
      return result;
    }

    const result = await this.adapter.act({
      ...request,
      risk: safety.risk
    });

    const tracedResult: ActionResult = {
      ...result,
      traceId: actionId,
      evidence: [...(result.evidence ?? []), "trace:" + actionId]
    };
    await this.trace.action(sessionId, request, tracedResult, actionId).catch(() => []);

    if (result.status === "executed" || result.status === "uncertain") {
      this.sessions.consumeObservation(sessionId);
    }

    return tracedResult;
  }

  async stop(sessionId: string) {
    await this.adapter.stop();
    await this.trace.record({
      id: randomUUID(),
      kind: "session_stop",
      sessionId,
      timestamp: new Date().toISOString(),
      payload: {}
    }).catch(() => []);

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
