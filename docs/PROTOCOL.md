# Protocol

## Observation

An observation contains:

- observation_id
- timestamp
- platform
- active window
- displays
- accessibility nodes
- optional OCR
- optional screenshot reference
- health/capability data

## Action

Actions describe intent, not implementation.

Examples:

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

This distinction is intentional: an OS-level click succeeding does not prove
that the desired application state was reached.

## Stale observations

Adapters can reject actions against an old observation.

The runtime therefore exposes an observation ID and verifies freshness before
dispatching an action.

## Safety

The protocol leaves room for:

- auto
- ask
- deny

and risk tiers:

- safe
- sensitive
- dangerous

The initial runtime stores these semantics without forcing a specific UI.
