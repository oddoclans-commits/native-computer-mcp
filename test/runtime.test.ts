import test from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/core/session.js";
import { ComputerRuntime } from "../src/core/runtime.js";
import { createDefaultAdapter } from "../src/adapters/factory.js";
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

test("default adapter is selected from the host OS", () => {
  const adapter = createDefaultAdapter();

  if (process.platform === "win32") {
    assert.equal(adapter.platform, "windows");
  } else if (process.platform === "linux") {
    assert.equal(adapter.platform, "linux");
  } else {
    assert.equal(adapter.platform, "unknown");
  }
});
