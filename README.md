# native-computer-mcp

Universal Native Computer MCP.

The project separates the **OS-agnostic computer-use contract** from
platform-specific native implementations.

## Architecture

```
ANY AGENT
    |
  MCP
    |
native-computer-mcp
    |
    +-- Windows adapter
    +-- macOS adapter
    +-- Linux adapter
```

The core runtime is deliberately model-agnostic. It does not contain an
LLM, browser automation framework, or platform-specific input code.

## Runtime contract

The intended lifecycle is:

`observe -> act -> execute -> artifact -> approval -> resume`

The first implementation slice establishes:

- persistent sessions
- observation IDs and stale-observation protection
- unified observation/action/result types
- adapter boundary
- MCP status/start/observe/act/stop tools
- explicit verification state

Native adapters will be added behind the same interface.

## Development

Requirements:

- Node.js 20+
- npm

Install and typecheck:

```bash
npm install
npm run typecheck
```

Build:

```bash
npm run build
```

Run over stdio:

```bash
npm start
```

## Status

v0.1 is a protocol/runtime foundation. The default adapter is intentionally
unavailable until a real native backend is installed.
