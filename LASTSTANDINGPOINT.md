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
- GitHub Actions CI for Linux and Windows
- Windows UI Automation assembly smoke test

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
- Linux currently supports X11, not Wayland.
- Accessibility tree support is Windows-first.
- OCR is not implemented.
- Browser/CDP surface has direct target listing, accessibility snapshot, navigation, find, click, type, and Runtime.evaluate.
- Windows file/folder/save dialogs are now first-class tools.
- macOS AX adapter is implemented; real desktop permission/runtime testing still requires a macOS user session.
- Rich post-action verification is still agent-driven via fresh observations.

## Next engineering order

1. Rich screenshot/state diff helpers.
2. Browser session persistence and richer browser verification.
3. Linux AT-SPI richer actions and Wayland bridge.
4. macOS AX richer actions and screenshot capture.
5. Trace/artifact retention policy and turn/action evidence IDs.
7. Broader cross-platform capability negotiation.

## Design invariant

Keep the MCP contract OS-agnostic.

Native APIs, helper processes, UIA/AX/AT-SPI details, browser engines, and
platform-specific workarounds belong inside adapters/surfaces.
