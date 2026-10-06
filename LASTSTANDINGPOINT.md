# Last Standing Point

Updated: 2026-10-06

## Current checkpoint

native-computer-mcp is a working OS-agnostic MCP/runtime foundation with:

- persistent sessions
- stale/consumed observation protection
- strict action schemas
- lightweight safety modes
- screenshot image transport
- Windows native Win32 input
- Windows UI Automation discovery and semantic actions
- Linux X11 native input
- Linux AT-SPI adapter
- Linux Wayland adapter with semantic AT-SPI targets and native Wayland input fallbacks
- Linux window/display discovery
- semantic target query via `computer_find`
- GitHub Actions CI for Linux, Windows, and macOS
- Windows UI Automation assembly smoke test
- macOS Swift AX helper validation

## Windows UIA loop

```
computer_start
  -> computer_observe
  -> computer_find(query, role?)
  -> computer_act(targetId)
  -> computer_observe
  -> verify
```

UIA target IDs are observation-scoped and must be refreshed after a mutating
action.

Supported semantic Windows actions:

- click(targetId)
- click(targetId, button=right/middle)
- set_value(targetId)
- secondary_action(targetId)

UIA primary click preference:

1. InvokePattern
2. SelectionItemPattern
3. TogglePattern
4. clickable point fallback

## Current limitations

- Windows UIA has not been exercised against a real interactive Windows desktop
  in this environment; CI verifies compilation/parser/assembly availability.
- Linux supports X11 pointer input and AT-SPI semantic accessibility, plus a Wayland adapter using AT-SPI, `wtype`, `ydotool`, and `grim` when those capabilities are installed.
- Accessibility trees now normalize into the universal `AccessibilityNode` contract across native desktop adapters and the browser CDP surface.
- OCR is not implemented.
- Browser/CDP surface has direct target listing, raw + normalized accessibility snapshots, state/verify, navigation, find, semantic-query click/type, CSS-selector click/type, and Runtime.evaluate.
- Browser sessions can attach to an existing target or launch a detached Chromium-family process with a persistent user-data directory; session records survive MCP restarts.
- Windows file/folder/save dialogs are now first-class tools.
- macOS AX adapter is implemented; real desktop permission/runtime testing still requires a macOS user session.
- Rich verification now has a reusable state/screenshot diff primitive and `computer_diff` MCP tool.
- Diffing uses exact screenshot SHA-256 fingerprints plus active-window, display, window, and accessibility-tree deltas.
- Consumed observations remain available as the previous verification baseline, preserving the canonical `observe -> act -> observe -> verify/diff` loop.
- `computer_status` now exposes capability negotiation and runtime safety budgets.

## Next engineering order

1. Real interactive E2E lab sessions on Windows, macOS, Linux X11, and Linux Wayland.
2. Browser CDP E2E with navigation and DOM-replacement/stale-target cases.
3. Hard interrupt/input-release implementations per native adapter.
4. Trace/artifact retention and crash-recovery policy.
5. Agent integration: OpenCode/Pi/Claude/Codex/Gemini.

## Design invariant

Keep the MCP contract OS-agnostic.

Native APIs, helper processes, UIA/AX/AT-SPI details, browser engines, and
platform-specific workarounds belong inside adapters/surfaces.
