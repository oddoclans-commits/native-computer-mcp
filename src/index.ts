import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ComputerRuntime } from "./core/runtime.js";
import { UnavailableAdapter } from "./adapters/unavailable.js";

const runtime = new ComputerRuntime(new UnavailableAdapter());

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
  "Capture a fresh observation for an active session.",
  {
    session_id: z.string()
  },
  async ({ session_id }) => {
    const observation = await runtime.observe(session_id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(observation, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "computer_act",
  "Execute one action against the current fresh observation.",
  {
    session_id: z.string(),
    observation_id: z.string(),
    action: z.record(z.unknown())
  },
  async ({ session_id, observation_id, action }) => {
    const result = await runtime.act(session_id, {
      observationId: observation_id,
      action: action as never
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
    session_id: z.string()
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
