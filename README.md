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
    +-- macOS AX adapter
    +-- Linux adapter
    +-- Browser CDP surface
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
- direct CDP browser tools: status, tabs, raw + normalized accessibility, state, verify, find, navigate, evaluate, and locator-based click/type
- browser locators can use either CSS selectors or semantic accessibility queries
- persistent browser sessions with restart-safe session records and detached profile launcher
- Linux X11 native input + window/display discovery + screenshots
- Linux Wayland adapter with AT-SPI semantic targets, `wtype` keyboard input, `ydotool` pointer/scroll/drag input, and `grim` screenshots
- Linux AT-SPI semantic accessibility discovery/actions when pyatspi is available, with X11 pointer fallback for secondary/middle-click targets
- explicit action/verification semantics
- trace IDs on action results (`trace:<uuid>`) with optional agent-supplied `turn_id`
- GitHub Actions CI on Linux, Windows, and macOS

Current limitations:

- OCR is not implemented.
- Wayland window-management APIs remain compositor-specific; the adapter does not pretend to provide a universal `activate_window` implementation.
- Wayland pointer/drag input uses `ydotool` when available; its daemon uses Linux `/dev/uinput` and may require elevated host permissions.
- Browser CDP is an independent first-class surface; its normalized AX tree reuses the universal `AccessibilityNode` contract, while its verification contract remains separate from the desktop observation lifecycle.
- macOS requires Accessibility permission and a real interactive user session for runtime validation.
- macOS observation captures the main display through the native `screencapture` utility when screen capture permission allows it.
- Rich diffing compares screenshot fingerprints and semantic/window state; pixel heatmaps are not included yet.
- Browser state fingerprints are bounded to URL/title/readyState/body text and are intended for lightweight verification, not full DOM archival.
- Browser session records persist under `.artifacts/browser-sessions/`; they reconnect to a still-running target but do not checkpoint or restore an arbitrary browser process after a crash.
- Browser launch is intentionally minimal: it starts a Chromium-family process with a persistent `user-data-dir` and loopback CDP endpoint; it does not manage extensions, profiles inside the browser UI, or browser-specific policies.

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
