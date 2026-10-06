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
    +-- richer macOS AX actions beyond the initial semantic/coordinate set
    +-- Linux adapter
```

The core runtime is model-agnostic. It does not contain an LLM or a
platform-specific perception model.

## Runtime contract

The working lifecycle is:

`observe -> act -> observe -> verify`

The broader protocol is designed to support:

`observe -> act -> execute -> artifact -> approval -> resume`

A successful native input event does not automatically mean the requested task
state was reached.

## Current implementation

v0.1 currently includes:

- persistent runtime sessions
- observation IDs with stale/consumed observation protection
- strict MCP action schemas
- screenshot delivery as MCP image content
- Windows native input + window/display discovery + screenshots
- Windows UIA accessibility tree with `targetId`, `ValuePattern`, invoke/toggle/select, and semantic secondary actions
- native dialog helpers: select file, select folder, set save path
- direct CDP browser tools: status, tabs, accessibility snapshot, state, verify, find, navigate, click, type, evaluate
- Linux X11 native input + window/display discovery + screenshots
- Linux AT-SPI semantic accessibility discovery when pyatspi is available
- explicit action/verification semantics
- GitHub Actions CI on Linux, Windows, and macOS

Current limitations:

- OCR is not implemented.
- Wayland input is not implemented.
- Browser CDP is an independent first-class surface; its verification contract is separate from the desktop observation lifecycle.
- macOS requires Accessibility permission and a real interactive user session for runtime validation.
- Rich diffing compares screenshot fingerprints and semantic/window state; pixel heatmaps are not included yet.
- Browser state fingerprints are bounded to URL/title/readyState/body text and are intended for lightweight verification, not full DOM archival.

## Development

Requirements:

- Node.js 20+
- npm

Install:

```bash
npm install
```

Typecheck, test, and build:

```bash
npm run typecheck
npm test
npm run build
```

Run over stdio:

```bash
npm start
```

## Design rule

The MCP contract must remain OS-agnostic. Platform-specific APIs belong
strictly inside adapters.
