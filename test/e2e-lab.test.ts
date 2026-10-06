import test from "node:test";
import assert from "node:assert/strict";
import { ComputerRuntime, type RuntimeOptions } from "../src/core/runtime.js";
import type { ActionRequest, AdapterStatus, ComputerAdapter, Observation } from "../src/types.js";

class LabAdapter implements ComputerAdapter {
  readonly platform = "windows" as const;
  readonly name = "e2e-lab";
  private step = 0;
  actCalls = 0;
  interrupts = 0;
  releases = 0;

  async status(): Promise<AdapterStatus> {
    return {
      ready: true,
      capabilities: [
        "native_input",
        "screenshot",
        "ui_automation",
        "semantic_targets",
        "semantic_actions",
        "window_discovery"
      ]
    };
  }

  async start(): Promise<void> {}

  async observe(): Promise<Observation> {
    this.step += 1;
    const saved = this.step >= 2;

    return {
      observationId: `lab-obs-${this.step}`,
      timestamp: new Date().toISOString(),
      platform: "windows",
      activeWindow: {
        id: "window-1",
        title: saved ? "Lab - Saved" : "Lab",
        appName: "E2E Lab",
        focused: true
      },
      displays: [{ id: "display-1", bounds: { x: 0, y: 0, width: 1280, height: 720 } }],
      windows: [{
        id: "window-1",
        title: saved ? "Lab - Saved" : "Lab",
        appName: "E2E Lab",
        focused: true
      }],
      accessibility: [{
        id: "uia:save",
        role: "Button",
        name: saved ? "Saved" : "Save",
        enabled: true
      }],
      capabilities: (await this.status()).capabilities
    };
  }

  async act(_request: ActionRequest) {
    this.actCalls += 1;
    return {
      status: "executed" as const,
      verification: "needs_observation" as const,
      nextObservationRequired: true,
      evidence: ["lab:act"]
    };
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1;
  }

  async releaseInputs(): Promise<void> {
    this.releases += 1;
  }

  async stop(): Promise<void> {}
}

test("E2E lab proves observe -> find -> act -> observe -> verify -> diff", async () => {
  const adapter = new LabAdapter();
  const runtime = new ComputerRuntime(adapter);
  const session = await runtime.start();

  const first = await runtime.observe(session.id);
  assert.equal(runtime.find(session.id, first.observationId, "Save", "Button")[0]?.targetId, "uia:save");

  const acted = await runtime.act(session.id, {
    observationId: first.observationId,
    action: { type: "click", targetId: "uia:save" }
  });
  assert.equal(acted.status, "executed");
  assert.equal(adapter.actCalls, 1);

  const second = await runtime.observe(session.id);
  const verification = runtime.verify(session.id, second.observationId, {
    activeWindowTitleContains: "Saved",
    expectChanged: true,
    includeDiff: true
  });

  assert.equal(verification.status, "confirmed");
  assert.equal(verification.changed, true);
  assert.equal(verification.diff?.activeWindowChanged, true);
  assert.equal(verification.diff?.accessibility.changedIds.includes("uia:save"), true);
  assert.equal(runtime.diff(session.id, second.observationId).changed, true);

  await runtime.stop(session.id);
  assert.equal(adapter.releases, 1);
});

test("E2E lab runtime budget blocks runaway action loops", async () => {
  const adapter = new LabAdapter();
  const options: RuntimeOptions = { maxActionsPerSession: 1, maxSessionDurationMs: 60_000 };
  const runtime = new ComputerRuntime(adapter, undefined, options);
  const session = await runtime.start();
  const first = await runtime.observe(session.id);

  await runtime.act(session.id, {
    observationId: first.observationId,
    action: { type: "click", point: { x: 10, y: 10 } }
  });

  const second = await runtime.observe(session.id);
  await assert.rejects(
    () => runtime.act(session.id, {
      observationId: second.observationId,
      action: { type: "click", point: { x: 20, y: 20 } }
    }),
    /maximum action budget/
  );

  await runtime.stop(session.id);
});

test("E2E lab capability negotiation reports requested support and fallbacks", async () => {
  const runtime = new ComputerRuntime(new LabAdapter());
  const status = await runtime.status(["semantic_actions", "ocr"]);

  assert.deepEqual(status.negotiation.supported, ["semantic_actions"]);
  assert.deepEqual(status.negotiation.missing, ["ocr"]);
  assert.equal(status.negotiation.preferred.click, "semantic_target");
  assert.equal(status.negotiation.fallbacks.click.includes("semantic_target"), true);
});
