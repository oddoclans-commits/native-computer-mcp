import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ComputerRuntime } from "./core/runtime.js";
import { createDefaultAdapter } from "./adapters/factory.js";
import {
  actionSchema,
  riskTierSchema,
  safetyModeSchema
} from "./mcp/action-schema.js";
import { verificationSpecSchema } from "./mcp/verification-schema.js";
import { CdpBrowserSurface } from "./surfaces/browser/cdp.js";

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
  "computer_act",
  "Execute one native action against a fresh observation. Each successful or uncertain action consumes that observation and requires a new observe.",
  {
    session_id: z.string().min(1),
    observation_id: z.string().min(1),
    action: actionSchema,
    risk: riskTierSchema.optional(),
    safety_mode: safetyModeSchema.optional()
  },
  async ({ session_id, observation_id, action, risk, safety_mode }) => {
    const result = await runtime.act(session_id, {
      observationId: observation_id,
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
  "browser_snapshot",
  "Read the accessibility snapshot of a browser target through CDP.",
  {
    target_id: z.string().min(1),
    endpoint: z.string().url().optional()
  },
  async ({ target_id, endpoint }) => ({
    content: [{ type: "text", text: JSON.stringify(await browser.snapshot(target_id, endpoint), null, 2) }]
  })
);

server.tool(
  "browser_navigate",
  "Navigate a browser target through CDP Page.navigate.",
  {
    target_id: z.string().min(1),
    url: z.string().url(),
    endpoint: z.string().url().optional()
  },
  async ({ target_id, url, endpoint }) => ({
    content: [{ type: "text", text: JSON.stringify(await browser.navigate(target_id, url, endpoint), null, 2) }]
  })
);

server.tool(
  "browser_evaluate",
  "Evaluate JavaScript in a browser target through CDP Runtime.evaluate.",
  {
    target_id: z.string().min(1),
    expression: z.string().min(1).max(100_000),
    endpoint: z.string().url().optional()
  },
  async ({ target_id, expression, endpoint }) => ({
    content: [{ type: "text", text: JSON.stringify(await browser.evaluate(target_id, expression, endpoint), null, 2) }]
  })
);

server.tool(
  "browser_find",
  "Find DOM candidates by text/ARIA/name/id using the current browser target.",
  {
    target_id: z.string().min(1),
    query: z.string().min(1).max(512),
    role: z.string().max(128).optional(),
    endpoint: z.string().url().optional()
  },
  async ({ target_id, query, role, endpoint }) => ({
    content: [{ type: "text", text: JSON.stringify(await browser.find(target_id, query, role, endpoint), null, 2) }]
  })
);

server.tool(
  "browser_click",
  "Click a DOM element by CSS selector using the browser CDP surface.",
  {
    target_id: z.string().min(1),
    selector: z.string().min(1).max(2048),
    endpoint: z.string().url().optional()
  },
  async ({ target_id, selector, endpoint }) => ({
    content: [{ type: "text", text: JSON.stringify(await browser.clickSelector(target_id, selector, endpoint), null, 2) }]
  })
);

server.tool(
  "browser_type",
  "Type text into a DOM input/contenteditable selected by CSS selector using the browser CDP surface.",
  {
    target_id: z.string().min(1),
    selector: z.string().min(1).max(2048),
    text: z.string().max(100_000),
    endpoint: z.string().url().optional()
  },
  async ({ target_id, selector, text, endpoint }) => ({
    content: [{ type: "text", text: JSON.stringify(await browser.typeSelector(target_id, selector, text, endpoint), null, 2) }]
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
