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
- Linux currently supports X11 pointer input and AT-SPI semantic accessibility; Wayland pointer input is not implemented.
- Accessibility trees now normalize into the universal `AccessibilityNode` contract across native desktop adapters and the browser CDP surface.
- OCR is not implemented.
- Browser/CDP surface has direct target listing, raw + normalized accessibility snapshots, state/verify, navigation, find, click, type, and Runtime.evaluate.
- Browser sessions can attach to an existing target or launch a detached Chromium-family process with a persistent user-data directory; session records survive MCP restarts.
- Windows file/folder/save dialogs are now first-class tools.
- macOS AX adapter is implemented; real desktop permission/runtime testing still requires a macOS user session.
- Rich verification now has a reusable state/screenshot diff primitive and `computer_diff` MCP tool.
- Diffing uses exact screenshot SHA-256 fingerprints plus active-window, display, window, and accessibility-tree deltas.

## Next engineering order

1. Linux AT-SPI richer actions and Wayland bridge.
2. macOS AX richer actions.
3. Browser semantic targeting from normalized AX nodes, including target-safe activation.
4. Trace/artifact retention policy.
5. Broader cross-platform capability negotiation.

## Design invariant

Keep the MCP contract OS-agnostic.

Native APIs, helper processes, UIA/AX/AT-SPI details, browser engines, and
platform-specific workarounds belong inside adapters/surfaces.
