# Protocol

## Observation

An observation contains:

- observation_id
- timestamp
- platform
- active window
- displays
- windows
- optional accessibility nodes
- optional OCR
- optional screenshot
- capability list

Screenshots are transported to MCP clients as image content rather than
embedding large base64 payloads inside the textual observation.

## Action

Actions describe intent, not implementation.

Supported action types:

- click
- type
- key
- scroll
- drag
- set_value
- secondary_action
- activate_window

## Action result

`status`:

- executed
- rejected
- uncertain
- blocked

Verification is separate:

- not_checked
- confirmed
- changed
- failed
- needs_observation

An OS-level input event is not equivalent to task completion.

## Observation freshness

A session records the latest observation ID.

Every mutating action must reference that exact observation ID. After an
`executed` or `uncertain` action, the observation is consumed and a new
`computer_observe` is required.

This intentionally creates a cheap control loop:

`observe -> act -> observe -> verify`

Batch actions can be added later without weakening this invariant.

## Safety

The protocol supports:

- auto
- ask
- deny

and risk tiers:

- safe
- sensitive
- dangerous

The initial runtime transports these semantics while keeping the policy UI
outside the core.

## Adapter boundary

Adapters own native details such as:

- Win32 input APIs
- X11/Wayland APIs
- macOS Accessibility
- OCR engines
- browser/CDP integration

Those implementations must not leak into the MCP contract.
