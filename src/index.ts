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

const transport = new StdioServerTransport();
await server.connect(transport);
