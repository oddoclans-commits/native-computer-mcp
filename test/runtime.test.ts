import test from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/core/session.js";
import { createDefaultAdapter } from "../src/adapters/factory.js";
import type { Observation } from "../src/types.js";

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
