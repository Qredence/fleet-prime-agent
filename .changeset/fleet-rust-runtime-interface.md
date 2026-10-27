---
"@qredence/fleet": minor
---

Run on Prime Agent's native runtime. Fleet now talks to the Prime Agent daemon directly instead of through the legacy TypeScript SDK, and reports a clear error when the installed daemon is not a compatible version. Fleet requires the Rust daemon: a TypeScript daemon that advertises the same protocol and schema revision is refused, because Fleet no longer carries a second adapter path for it.

Recover chat sessions automatically when an invalid stream event interrupts the browser stream. Replayed text and tool events now resume after a malformed reasoning frame, missing runtime reasoning indexes are normalized before they reach the browser, and steering mid-recovery no longer drops the replayed answer.

Improve Fleet's navigation for sessions, agents, and connectors, and retire legacy runtime recap and error surfaces. Keep the selected chat model across page reloads.
