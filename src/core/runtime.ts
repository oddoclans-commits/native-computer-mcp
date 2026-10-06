import { randomUUID } from "node:crypto";
import { SessionManager } from "./session.js";
import { verifyObservation, type VerificationSpec } from "./verification.js";
import { observationDiff } from "./diff.js";
import { FileTraceSink } from "./trace.js";
import { findAccessibilityNodes, type AccessibilityMatch } from "./query.js";
import { negotiateCapabilities } from "./capabilities.js";
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

export interface RuntimeOptions {
  actionTimeoutMs?: number;
  maxActionsPerSession?: number;
  maxSessionDurationMs?: number;
}

interface RuntimeBudget {
  startedAtMs: number;
  actions: number;
}

const DEFAULT_RUNTIME_OPTIONS: Required<RuntimeOptions> = {
  actionTimeoutMs: 30_000,
  maxActionsPerSession: 250,
  maxSessionDurationMs: 30 * 60 * 1000
};

export class ComputerRuntime {
  readonly sessions = new SessionManager();
  private readonly options: Required<RuntimeOptions>;
  private readonly budgets = new Map<string, RuntimeBudget>();
  private readonly activeActions = new Set<string>();

  constructor(
    private readonly adapter: ComputerAdapter,
    private readonly trace = new FileTraceSink(),
    options: RuntimeOptions = {}
  ) {
    this.options = { ...DEFAULT_RUNTIME_OPTIONS, ...options };
  }

  async status(requested: string[] = []) {
    const adapterStatus = await this.adapter.status();
    return {
      adapter: this.adapter.name,
      platform: this.adapter.platform,
      ...adapterStatus,
      negotiation: negotiateCapabilities(
        this.adapter.platform,
        this.adapter.name,
        adapterStatus.capabilities,
        requested
      ),
      runtime: {
        actionTimeoutMs: this.options.actionTimeoutMs,
        maxActionsPerSession: this.options.maxActionsPerSession,
        maxSessionDurationMs: this.options.maxSessionDurationMs
      }
    };
  }

  async start() {
    await this.adapter.start();
    const session = this.sessions.create();
    this.budgets.set(session.id, { startedAtMs: Date.now(), actions: 0 });

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
    this.assertBudget(sessionId);

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
    this.assertBudget(sessionId);

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
    this.assertBudget(sessionId);

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
    this.assertBudget(sessionId);

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

    this.bumpActionBudget(sessionId);
    this.activeActions.add(sessionId);

    let result: ActionResult;
    try {
      result = await this.withTimeout(
        this.adapter.act({
          ...request,
          risk: safety.risk
        }),
        this.options.actionTimeoutMs
      );
    } catch (error) {
      await this.adapter.interrupt?.().catch(() => {});
      await this.adapter.releaseInputs?.().catch(() => {});
      result = {
        status: "uncertain",
        verification: "needs_observation",
        nextObservationRequired: true,
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      this.activeActions.delete(sessionId);
    }

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

  async cancel(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session.active) throw new Error("Session is not active.");

    await this.adapter.interrupt?.().catch(() => {});
    await this.adapter.releaseInputs?.().catch(() => {});

    return {
      sessionId,
      activeAction: this.activeActions.has(sessionId),
      cancelled: true,
      message: this.adapter.interrupt
        ? "Cancellation signal sent to the native adapter."
        : "Cancellation requested, but this adapter does not expose an interrupt hook; input release was attempted."
    };
  }

  async stop(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session.active) return session;

    try {
      await this.adapter.interrupt?.().catch(() => {});
      await this.adapter.releaseInputs?.().catch(() => {});
      await this.adapter.stop();
    } finally {
      this.budgets.delete(sessionId);
      this.activeActions.delete(sessionId);
      await this.trace.record({
        id: randomUUID(),
        kind: "session_stop",
        sessionId,
        timestamp: new Date().toISOString(),
        payload: {}
      }).catch(() => []);
    }

    return this.sessions.stop(sessionId);
  }

  private assertBudget(sessionId: string): void {
    const budget = this.budgets.get(sessionId);
    if (!budget) throw new Error("Runtime session budget is not available.");

    if (Date.now() - budget.startedAtMs > this.options.maxSessionDurationMs) {
      throw new Error(
        `Session exceeded the maximum runtime budget of ${this.options.maxSessionDurationMs}ms.`
      );
    }
  }

  private bumpActionBudget(sessionId: string): void {
    const budget = this.budgets.get(sessionId);
    if (!budget) throw new Error("Runtime session budget is not available.");

    if (budget.actions >= this.options.maxActionsPerSession) {
      throw new Error(
        `Session exceeded the maximum action budget of ${this.options.maxActionsPerSession} actions.`
      );
    }

    budget.actions += 1;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Native action timed out after ${timeoutMs}ms.`)),
            timeoutMs
          );
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
