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

A blocked action does not consume the observation because no native state
change occurred.

This intentionally creates a cheap control loop:

`observe -> act -> observe -> verify`

Batch actions can be added later without weakening this invariant.

## Safety

Safety defaults to `auto` so normal interaction does not create noisy
approval prompts.

The core infers a baseline risk:

- safe: click, scroll, drag
- sensitive: typing, key presses, window activation, value setting, secondary actions

Callers may raise the requested risk but cannot lower the core's inferred
risk.

When the mode is `ask` or `deny`, sensitive/dangerous actions are blocked
at the runtime boundary before reaching a native adapter.

No approval UI is embedded in the core; an agent or host can decide how to
resume an approval-required action later.
