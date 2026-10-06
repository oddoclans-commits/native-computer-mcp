# Architecture

## Boundary

The core runtime knows only the computer-use protocol.

It must not know:

- Win32/UIA implementation details
- macOS Accessibility implementation details
- Linux AT-SPI/X11/Wayland implementation details
- browser-specific CDP or Playwright internals

Those concerns belong to adapters/surfaces.

## Layers

### Core

Owns:

- sessions
- observation freshness
- action/result semantics
- verification state
- safety metadata
- runtime lifecycle

### MCP

Exposes the protocol to any MCP-capable agent.

### Adapters

Translate the unified protocol to a native operating-system backend.

### Surfaces

Represent specialized control planes such as:

- desktop
- browser
- dialog/file picker

## Perception strategy

Preferred order:

1. accessibility / semantic target
2. OCR / visual location
3. screenshot / coordinate fallback

The protocol can carry all three without forcing a specific perception implementation.

## Invariants

- An action may require a fresh observation.
- Observation IDs are immutable.
- Action execution does not imply task completion.
- Verification is explicit.
- Session state survives individual tool calls.
- Adapters are replaceable without changing the MCP contract.
