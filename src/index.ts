import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, type ZodRawShape } from "zod";
import { ComputerRuntime } from "./core/runtime.js";
import { createDefaultAdapter } from "./adapters/factory.js";
import {
  actionSchema,
  riskTierSchema,
  safetyModeSchema
} from "./mcp/action-schema.js";
import { verificationSpecSchema } from "./mcp/verification-schema.js";
import { CdpBrowserSurface } from "./surfaces/browser/cdp.js";
import { BrowserLauncher, BrowserSessionStore } from "./surfaces/browser/runtime.js";

const runtime = new ComputerRuntime(createDefaultAdapter());

const server = new McpServer({
  name: "native-computer-mcp",
  version: "0.1.0"
});

server.tool(
  "computer_status",
  "Return adapter readiness, platform, and capabilities.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(await runtime.status(), null, 2)
      }
    ]
  })
);

server.tool(
  "computer_start",
  "Start a persistent computer-use session.",
  {},
  async () => {
    const session = await runtime.start();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(session, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "computer_observe",
  "Capture a fresh observation for an active session. The observation_id is required for the next action.",
  {
    session_id: z.string().min(1)
  },
  async ({ session_id }) => {
    const observation = await runtime.observe(session_id);
    const { screenshot, ...metadata } = observation;

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    > = [
      {
        type: "text",
        text: JSON.stringify(metadata, null, 2)
      }
    ];

    if (screenshot?.data) {
      content.push({
        type: "image",
        data: screenshot.data,
        mimeType: screenshot.mimeType
      });
    }

    return { content };
  }
);

server.tool(
  "computer_find",
  "Find semantic accessibility targets in the latest fresh observation without consuming it.",
  {
    session_id: z.string().min(1),
    observation_id: z.string().min(1),
    query: z.string().min(1).max(512),
    role: z.string().min(1).max(128).optional()
  },
  async ({ session_id, observation_id, query, role }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            query,
            ...(role ? { role } : {}),
            matches: runtime.find(session_id, observation_id, query, role)
          },
          null,
          2
        )
      }
    ]
  })
);

server.tool(
  "computer_select_file",
  "Select a file in a native file picker using the current fresh observation.",
  {
    session_id: z.string().min(1),
    observation_id: z.string().min(1),
    path: z.string().min(1).max(4096)
  },
  async ({ session_id, observation_id, path }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await runtime.selectFile(session_id, observation_id, path),
          null,
          2
        )
      }
    ]
  })
);

server.tool(
  "computer_select_folder",
  "Select a folder in a native folder picker using the current fresh observation.",
  {
    session_id: z.string().min(1),
    observation_id: z.string().min(1),
    path: z.string().min(1).max(4096)
  },
  async ({ session_id, observation_id, path }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await runtime.selectFolder(session_id, observation_id, path),
          null,
          2
        )
      }
    ]
  })
);

server.tool(
  "computer_set_save_path",
  "Set the target path in a native save dialog and press Save.",
  {
    session_id: z.string().min(1),
    observation_id: z.string().min(1),
    path: z.string().min(1).max(4096)
  },
  async ({ session_id, observation_id, path }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          await runtime.setSavePath(session_id, observation_id, path),
          null,
          2
        )
      }
    ]
  })
);

server.tool(
  "computer_verify",
  "Verify the current fresh observation against window/semantic expectations and optionally detect change from the previous observation.",
  {
    session_id: z.string().min(1),
    observation_id: z.string().min(1),
    expect: verificationSpecSchema
  },
  async ({ session_id, observation_id, expect }) => {
    const result = runtime.verify(session_id, observation_id, expect);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool(
  "computer_diff",
  "Compare the current fresh observation with the previous observation without consuming it.",
  {
    session_id: z.string().min(1),
    observation_id: z.string().min(1)
  },
  async ({ session_id, observation_id }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(runtime.diff(session_id, observation_id), null, 2)
      }
    ]
  })
);

server.tool(
  "computer_act",
  "Execute one native action against a fresh observation. Each successful or uncertain action consumes that observation and requires a new observe.",
  {
    session_id: z.string().min(1),
    observation_id: z.string().min(1),
    turn_id: z.string().min(1).max(256).optional(),
    action: actionSchema,
    risk: riskTierSchema.optional(),
    safety_mode: safetyModeSchema.optional()
  },
  async ({ session_id, observation_id, turn_id, action, risk, safety_mode }) => {
    const result = await runtime.act(session_id, {
      observationId: observation_id,
      ...(turn_id ? { turnId: turn_id } : {}),
      action,
      ...(risk ? { risk } : {}),
      ...(safety_mode ? { safetyMode: safety_mode } : {})
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "computer_stop",
  "Stop a persistent computer-use session.",
  {
    session_id: z.string().min(1)
  },
  async ({ session_id }) => {
    const session = await runtime.stop(session_id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(session, null, 2)
        }
      ]
    };
  }
);

const browser = new CdpBrowserSurface();
const browserSessions = new BrowserSessionStore();
const browserLauncher = new BrowserLauncher();

const browserTargetFields = {
  target_id: z.string().min(1).max(256).optional(),
  session_id: z.string().min(1).max(256).optional(),
  endpoint: z.string().url().optional()
};

const browserTargetSchema = (extra: ZodRawShape = {}) =>
  z.object({
    ...browserTargetFields,
    ...extra
  }).refine(
    (input) => Boolean(input.target_id) !== Boolean(input.session_id),
    "Provide exactly one of target_id or session_id."
  );

async function resolveBrowserTarget(input: {
  target_id?: string;
  session_id?: string;
  endpoint?: string;
}): Promise<{ targetId: string; endpoint: string }> {
  if (input.session_id) {
    const session = await browserSessions.get(input.session_id);
    if (!session) throw new Error("Unknown browser session: " + input.session_id);
    return { targetId: session.targetId, endpoint: session.endpoint };
  }
  if (!input.target_id) throw new Error("A browser target or session is required.");
  return {
    targetId: input.target_id,
    endpoint: input.endpoint ?? "http://127.0.0.1:9222"
  };
}

server.tool(
  "browser_status",
  "Check a local Chromium DevTools Protocol endpoint.",
  { endpoint: z.string().url().optional() },
  async ({ endpoint }) => ({
    content: [{ type: "text", text: JSON.stringify(await browser.status(endpoint), null, 2) }]
  })
);

server.tool(
  "browser_tabs",
  "List browser tabs/targets from a local CDP endpoint.",
  { endpoint: z.string().url().optional() },
  async ({ endpoint }) => ({
    content: [{ type: "text", text: JSON.stringify(await browser.listTargets(endpoint), null, 2) }]
  })
);

server.tool(
  "browser_session_start",
  "Attach a persistent browser session to an existing target, or launch a detached Chromium profile and attach to its first page target.",
  {
    target_id: z.string().min(1).max(256).optional(),
    endpoint: z.string().url().optional(),
    user_data_dir: z.string().min(1).max(4096).optional(),
    executable: z.string().min(1).max(4096).optional(),
    url: z.string().url().optional()
  },
  async ({ target_id, endpoint, user_data_dir, executable, url }) => {
    const sessionEndpoint = endpoint ?? "http://127.0.0.1:9222";
    let launch;

    if (!target_id) {
      if (!user_data_dir) {
        throw new Error("user_data_dir is required when target_id is not provided.");
      }
      launch = await browserLauncher.launch({
        endpoint: sessionEndpoint,
        userDataDir: user_data_dir,
        ...(executable ? { executable } : {}),
        ...(url ? { url } : {})
      });
    }

    const targets = await browser.listTargets(sessionEndpoint);
    const target = target_id
      ? targets.find((item) => item.id === target_id)
      : targets.find((item) => item.type === "page");

    if (!target) {
      throw new Error(target_id
        ? "Browser target not found: " + target_id
        : "No browser page target is available at the requested CDP endpoint.");
    }

    const session = await browserSessions.create({
      targetId: target.id,
      endpoint: sessionEndpoint,
      target,
      ...(user_data_dir ? { userDataDir: user_data_dir } : {})
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ session, ...(launch ? { launch } : {}) }, null, 2)
      }]
    };
  }
);

server.tool(
  "browser_session_stop",
  "Detach and forget a persistent browser session without closing the browser process.",
  { session_id: z.string().min(1).max(256) },
  async ({ session_id }) => {
    const session = await browserSessions.remove(session_id);
    if (!session) throw new Error("Unknown browser session: " + session_id);
    await browser.disconnect(session.targetId);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ stopped: true, session }, null, 2)
      }]
    };
  }
);

server.tool(
  "browser_snapshot",
  "Read the raw accessibility snapshot of a browser target through CDP.",
  browserTargetSchema(),
  async ({ target_id, session_id, endpoint }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{ type: "text", text: JSON.stringify(await browser.snapshot(target.targetId, target.endpoint), null, 2) }]
    };
  }
);

server.tool(
  "browser_accessibility",
  "Return a normalized accessibility tree using the same AccessibilityNode contract as native desktop adapters.",
  browserTargetSchema(),
  async ({ target_id, session_id, endpoint }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(await browser.accessibility(target.targetId, target.endpoint), null, 2)
      }]
    };
  }
);

server.tool(
  "browser_navigate",
  "Navigate a browser target through CDP Page.navigate.",
  browserTargetSchema({ url: z.string().url() }),
  async ({ target_id, session_id, endpoint, url }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{ type: "text", text: JSON.stringify(await browser.navigate(target.targetId, url, target.endpoint), null, 2) }]
    };
  }
);

server.tool(
  "browser_state",
  "Read current browser URL, title, readyState, and a bounded body-text fingerprint.",
  browserTargetSchema(),
  async ({ target_id, session_id, endpoint }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{ type: "text", text: JSON.stringify(await browser.state(target.targetId, target.endpoint), null, 2) }]
    };
  }
);

server.tool(
  "browser_verify",
  "Verify current browser URL, title, text, and readyState without consuming a desktop observation.",
  browserTargetSchema({
    expect: z.object({
      url_contains: z.string().max(4096).optional(),
      title_contains: z.string().max(1024).optional(),
      text_contains: z.string().max(4096).optional(),
      ready_state_equals: z.enum(["loading", "interactive", "complete"]).optional()
    })
  }),
  async ({ target_id, session_id, endpoint, expect }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(
          await browser.verify(target.targetId, {
            ...(expect.url_contains !== undefined ? { urlContains: expect.url_contains } : {}),
            ...(expect.title_contains !== undefined ? { titleContains: expect.title_contains } : {}),
            ...(expect.text_contains !== undefined ? { textContains: expect.text_contains } : {}),
            ...(expect.ready_state_equals !== undefined ? { readyStateEquals: expect.ready_state_equals } : {})
          }, target.endpoint),
          null,
          2
        )
      }]
    };
  }
);

server.tool(
  "browser_evaluate",
  "Evaluate JavaScript in a browser target through CDP Runtime.evaluate.",
  browserTargetSchema({ expression: z.string().min(1).max(100_000) }),
  async ({ target_id, session_id, endpoint, expression }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{ type: "text", text: JSON.stringify(await browser.evaluate(target.targetId, expression, target.endpoint), null, 2) }]
    };
  }
);

server.tool(
  "browser_find",
  "Find DOM candidates by text/ARIA/name/id using the current browser target.",
  browserTargetSchema({
    query: z.string().min(1).max(512),
    role: z.string().max(128).optional()
  }),
  async ({ target_id, session_id, endpoint, query, role }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{ type: "text", text: JSON.stringify(await browser.find(target.targetId, query, role, target.endpoint), null, 2) }]
    };
  }
);

server.tool(
  "browser_click",
  "Click a DOM element by CSS selector using the browser CDP surface.",
  browserTargetSchema({ selector: z.string().min(1).max(2048) }),
  async ({ target_id, session_id, endpoint, selector }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{ type: "text", text: JSON.stringify(await browser.clickSelector(target.targetId, selector, target.endpoint), null, 2) }]
    };
  }
);

server.tool(
  "browser_type",
  "Type text into a DOM input/contenteditable selected by CSS selector using the browser CDP surface.",
  browserTargetSchema({
    selector: z.string().min(1).max(2048),
    text: z.string().max(100_000)
  }),
  async ({ target_id, session_id, endpoint, selector, text }) => {
    const target = await resolveBrowserTarget({ target_id, session_id, endpoint });
    return {
      content: [{ type: "text", text: JSON.stringify(await browser.typeSelector(target.targetId, selector, text, target.endpoint), null, 2) }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
