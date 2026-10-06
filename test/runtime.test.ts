import test from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/core/session.js";
import { ComputerRuntime } from "../src/core/runtime.js";
import { createDefaultAdapter } from "../src/adapters/factory.js";
import { findAccessibilityNodes } from "../src/core/query.js";
import { actionSchema } from "../src/mcp/action-schema.js";
import { verifyObservation } from "../src/core/verification.js";
import type { ComputerAdapter, Observation } from "../src/types.js";

test("session rejects stale observations and consumes successful actions", () => {
  const sessions = new SessionManager();
  const session = sessions.create();

  const observation: Observation = {
    observationId: "obs-1",
    timestamp: new Date().toISOString(),
    platform: "unknown",
    displays: [],
    windows: [],
    capabilities: []
  };

  sessions.recordObservation(session.id, observation);

  assert.doesNotThrow(() => sessions.assertFreshObservation(session.id, "obs-1"));
  assert.throws(() => sessions.assertFreshObservation(session.id, "obs-2"));

  sessions.consumeObservation(session.id);
  assert.throws(() => sessions.assertFreshObservation(session.id, "obs-1"));
});

test("safety mode blocks sensitive actions without consuming the observation", async () => {
  const adapter: ComputerAdapter = {
    platform: "unknown",
    name: "test",
    async status() {
      return { ready: true, capabilities: [] };
    },
    async start() {},
    async observe() {
      return {
        observationId: "obs-1",
        timestamp: new Date().toISOString(),
        platform: "unknown",
        displays: [],
        windows: [],
        capabilities: []
      };
    },
    async act() {
      throw new Error("adapter must not be called");
    },
    async stop() {}
  };

  const runtime = new ComputerRuntime(adapter);
  const session = await runtime.start();
  const observation = await runtime.observe(session.id);

  const result = await runtime.act(session.id, {
    observationId: observation.observationId,
    action: { type: "type", text: "secret" },
    safetyMode: "deny"
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.verification, "not_checked");

  assert.doesNotThrow(() =>
    runtime.sessions.assertFreshObservation(session.id, observation.observationId)
  );
});

test("accessibility query ranks exact semantic matches first", () => {
  const matches = findAccessibilityNodes(
    [{ id: "uia:1", role: "Button", name: "Save" }],
    "save"
  );
  assert.equal(matches[0]?.targetId, "uia:1");
  assert.equal(matches[0]?.score, 18);
});

test("semantic find requires a fresh observation", async () => {
  const adapter: ComputerAdapter = {
    platform: "windows",
    name: "test",
    async status() { return { ready: true, capabilities: ["ui_automation"] }; },
    async start() {},
    async observe() {
      return {
        observationId: "obs-find",
        timestamp: new Date().toISOString(),
        platform: "windows",
        displays: [],
        windows: [],
        accessibility: [{ id: "uia:9.1", role: "Button", name: "Save" }],
        capabilities: ["ui_automation"]
      };
    },
    async act() {
      return { status: "executed", verification: "needs_observation", nextObservationRequired: true };
    },
    async stop() {}
  };

  const runtime = new ComputerRuntime(adapter);
  const session = await runtime.start();
  const observation = await runtime.observe(session.id);
  assert.equal(runtime.find(session.id, observation.observationId, "save")[0]?.targetId, "uia:9.1");

  await runtime.act(session.id, {
    observationId: observation.observationId,
    action: { type: "click", targetId: "uia:9.1" }
  });

  assert.throws(() => runtime.find(session.id, observation.observationId, "save"));
});

test("default adapter is selected from the host OS", () => {
  const adapter = createDefaultAdapter();

  if (process.platform === "win32") {
    assert.equal(adapter.platform, "windows");
  } else if (process.platform === "linux") {
    assert.equal(adapter.platform, "linux");
  } else if (process.platform === "darwin") {
    assert.equal(adapter.platform, "macos");
  } else {
    assert.equal(adapter.platform, "unknown");
  }
});


test("action schema accepts semantic click targets", () => {
  const parsed = actionSchema.parse({ type: "click", targetId: "uia:42.7" });
  assert.equal(parsed.type, "click");
  assert.equal(parsed.targetId, "uia:42.7");
  assert.throws(() => actionSchema.parse({ type: "click" }));
});

test("verification detects semantic/window expectations", () => {
  const observation: Observation = {
    observationId: "verify-1",
    timestamp: new Date().toISOString(),
    platform: "windows",
    activeWindow: {
      id: "1",
      title: "Editor - Notes",
      appName: "Editor",
      focused: true
    },
    displays: [],
    windows: [
      { id: "1", title: "Editor - Notes", appName: "Editor", focused: true }
    ],
    accessibility: [
      { id: "uia:1", role: "Button", name: "Save" }
    ],
    capabilities: ["ui_automation"]
  };

  const result = verifyObservation(
    observation,
    undefined,
    {
      activeWindowTitleContains: "Notes",
      activeAppNameEquals: "Editor",
      targetQuery: "Save",
      targetRole: "Button"
    }
  );

  assert.equal(result.status, "confirmed");
  assert.equal(result.checks.every((check) => check.passed), true);
});
