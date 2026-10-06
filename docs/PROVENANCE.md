# Provenance

The protocol design is informed by patterns found in existing computer-use
projects, but native-computer-mcp is intentionally an independent
OS-agnostic architecture.

Key inspirations include:

- accessibility-first targeting
- screenshot/OCR observation
- fresh-observation requirements
- persistent runtime/session lifecycle
- explicit action outcomes
- evidence and trace capture
- browser as a first-class surface

No source project is treated as the complete implementation target.
Platform adapters may borrow implementation ideas while preserving this
project's unified contract.
