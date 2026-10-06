import test from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../src/core/session.js";
import { ComputerRuntime } from "../src/core/runtime.js";
import { createDefaultAdapter } from "../src/adapters/factory.js";
import { findAccessibilityNodes } from "../src/core/query.js";
import { actionSchema } from "../src/mcp/action-schema.js";
import { verifyObservation } from "../src/core/verification.js";
import { observationDiff } from "../src/core/diff.js";
import type { BrowserTarget, ComputerAdapter, Observation } from "../src/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserSessionStore } from "../src/surfaces/browser/runtime.js";

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

test("Linux factory selects Wayland adapter when a Wayland session is advertised", async () => {
  if (process.platform !== "linux") return;

  const previousWayland = process.env.WAYLAND_DISPLAY;
  const previousSession = process.env.XDG_SESSION_TYPE;

  try {
    process.env.WAYLAND_DISPLAY = "wayland-0";
    delete process.env.XDG_SESSION_TYPE;

    const adapter = createDefaultAdapter();
    assert.equal(adapter.name, "linux-wayland-native");
  } finally {
    if (previousWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = previousWayland;

    if (previousSession === undefined) delete process.env.XDG_SESSION_TYPE;
    else process.env.XDG_SESSION_TYPE = previousSession;
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


test("observation diff reports window, accessibility, and screenshot changes", () => {
  const previous: Observation = {
    observationId: "prev",
    timestamp: new Date().toISOString(),
    platform: "windows",
    activeWindow: { id: "1", title: "Editor", appName: "Editor", focused: true },
    displays: [{ id: "0", bounds: { x: 0, y: 0, width: 100, height: 100 } }],
    windows: [{ id: "1", title: "Editor", appName: "Editor", focused: true }],
    accessibility: [{ id: "uia:1", role: "Button", name: "Save" }],
    screenshot: {
      mimeType: "image/png",
      data: Buffer.from("one").toString("base64"),
      width: 100,
      height: 100
    },
    capabilities: ["ui_automation"]
  };
  const current: Observation = {
    ...previous,
    observationId: "current",
    activeWindow: { id: "1", title: "Editor - Notes", appName: "Editor", focused: true },
    windows: [{ id: "1", title: "Editor - Notes", appName: "Editor", focused: true }],
    accessibility: [{ id: "uia:1", role: "Button", name: "Publish" }],
    screenshot: {
      mimeType: "image/png",
      data: Buffer.from("two").toString("base64"),
      width: 100,
      height: 100
    }
  };

  const diff = observationDiff(previous, current);
  assert.equal(diff.hasPrevious, true);
  assert.equal(diff.changed, true);
  assert.equal(diff.activeWindowChanged, true);
  assert.deepEqual(diff.windows.changedIds, ["1"]);
  assert.deepEqual(diff.accessibility.changedIds, ["uia:1"]);
  assert.equal(diff.screenshot.changed, true);
  assert.ok(diff.changedFields.includes("active_window"));
  assert.ok(diff.changedFields.includes("windows"));
  assert.ok(diff.changedFields.includes("accessibility"));
  assert.ok(diff.changedFields.includes("screenshot"));
});



test("action result traceId matches the persisted trace event and turnId", async () => {
  const events: string[] = [];
  const trace = new (await import("../src/core/trace.js")).FileTraceSink({
    async writeText(path, content) {
      events.push(content);
      return path;
    },
    async writeBytes(path, _data) {
      return path;
    }
  });

  const adapter: ComputerAdapter = {
    platform: "unknown",
    name: "trace-test",
    async status() { return { ready: true, capabilities: [] }; },
    async start() {},
    async observe() {
      return {
        observationId: "trace-obs",
        timestamp: new Date().toISOString(),
        platform: "unknown",
        displays: [],
        windows: [],
        capabilities: []
      };
    },
    async act() {
      return {
        status: "executed",
        verification: "needs_observation",
        nextObservationRequired: true
      };
    },
    async stop() {}
  };

  const runtime = new ComputerRuntime(adapter, trace);
  const session = await runtime.start();
  const observation = await runtime.observe(session.id);
  const result = await runtime.act(session.id, {
    observationId: observation.observationId,
    turnId: "turn-42",
    action: { type: "click", point: { x: 10, y: 20 } }
  });

  assert.ok(result.traceId);
  assert.ok(result.evidence?.includes("trace:" + result.traceId));

  const actEvent = events
    .map((value) => JSON.parse(value))
    .find((event) => event.kind === "act");
  assert.equal(actEvent?.id, result.traceId);
  assert.equal(actEvent?.actionId, result.traceId);
  assert.equal(actEvent?.turnId, "turn-42");
  assert.equal(actEvent?.payload?.result?.traceId, result.traceId);
});


test("browser AX normalization produces the universal accessibility node contract", async () => {
  const { normalizeCdpAxTree } = await import("../src/surfaces/browser/cdp.js");
  const roots = normalizeCdpAxTree({
    nodes: [
      {
        nodeId: "1",
        role: { value: "RootWebArea" },
        name: { value: "Example" },
        childIds: ["2"]
      },
      {
        nodeId: "2",
        role: { value: "button" },
        name: { value: "Save" },
        backendDOMNodeId: 42,
        properties: [
          { name: "focused", value: { value: true } },
          { name: "disabled", value: { value: false } }
        ]
      }
    ]
  });

  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.role, "RootWebArea");
  assert.equal(roots[0]?.children?.[0]?.id, "cdp:2");
  assert.equal(roots[0]?.children?.[0]?.name, "Save");
  assert.equal(roots[0]?.children?.[0]?.automationId, "42");
  assert.equal(roots[0]?.children?.[0]?.focused, true);
  assert.equal(roots[0]?.children?.[0]?.enabled, true);

  const { findAccessibilityNodes } = await import("../src/core/query.js");
  const matches = findAccessibilityNodes(roots, "save", "button");
  assert.equal(matches[0]?.targetId, "cdp:2");
  assert.equal(matches[0]?.score, 18);
});


test("browser sessions persist across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-computer-mcp-"));
  const filePath = join(directory, "sessions.json");

  try {
    const target: BrowserTarget = {
      id: "page-42",
      type: "page",
      title: "Example",
      url: "https://example.com"
    };

    const first = new BrowserSessionStore(filePath);
    const created = await first.create({
      targetId: target.id,
      endpoint: "http://127.0.0.1:9222",
      target,
      userDataDir: "/tmp/browser-profile-01"
    });

    const second = new BrowserSessionStore(filePath);
    const restored = await second.get(created.id);

    assert.equal(restored?.id, created.id);
    assert.equal(restored?.targetId, "page-42");
    assert.equal(restored?.endpoint, "http://127.0.0.1:9222");
    assert.equal(restored?.userDataDir, "/tmp/browser-profile-01");

    const removed = await second.remove(created.id);
    assert.equal(removed?.id, created.id);
    assert.equal(await second.get(created.id), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("runtime action timeout returns uncertain and releases inputs", async () => {
  const adapter: ComputerAdapter & { interrupted: number; released: number } = {
    platform: "windows",
    name: "timeout-test",
    interrupted: 0,
    released: 0,
    async status() { return { ready: true, capabilities: ["native_input"] }; },
    async start() {},
    async observe() {
      return {
        observationId: "timeout-obs",
        timestamp: new Date().toISOString(),
        platform: "windows",
        displays: [],
        windows: [],
        capabilities: ["native_input"]
      };
    },
    async act() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: "executed", verification: "needs_observation", nextObservationRequired: true };
    },
    async interrupt() { this.interrupted += 1; },
    async releaseInputs() { this.released += 1; },
    async stop() {}
  };

  const runtime = new ComputerRuntime(adapter, undefined, { actionTimeoutMs: 5 });
  const session = await runtime.start();
  const observation = await runtime.observe(session.id);

  const result = await runtime.act(session.id, {
    observationId: observation.observationId,
    action: { type: "click", point: { x: 1, y: 1 } }
  });

  assert.equal(result.status, "uncertain");
  assert.equal(result.nextObservationRequired, true);
  assert.equal(adapter.interrupted, 1);
  assert.equal(adapter.released, 1);
  assert.throws(() => runtime.sessions.assertFreshObservation(session.id, observation.observationId));
});

test("browser semantic guard rejects a replaced accessibility target", async () => {
  const { revalidateBrowserSemanticTarget } = await import("../src/surfaces/browser/guard.js");

  const candidate = {
    targetId: "cdp:1",
    automationId: "42",
    role: "button",
    name: "Save",
    score: 18,
    enabled: true
  };

  assert.throws(
    () => revalidateBrowserSemanticTarget(
      candidate,
      [{ id: "cdp:2", role: "button", name: "Save", automationId: "99", enabled: true }],
      "Save",
      "button"
    ),
    /stale or changed/
  );
});
