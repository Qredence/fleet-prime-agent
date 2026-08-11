# react-doctor documented false positives

Agent-triage convention only — the scanner never reads this file. The
authoritative suppression lives in `doctor.config.jsonc` (`ignore.overrides`);
this file records the evidence so future agent triage runs do not relitigate
these findings.

## Waiver 1 — `effect-needs-cleanup` @ `apps/web/src/lib/pi/use-pi-chat.ts:379`

- **Rule:** `react-doctor/effect-needs-cleanup` (severity: error)
- **Predicate the detector claims:** "`EventSource` creates a connection in
  useEffect without guaranteed cleanup."
- **Observed evidence (read):** the effect's returned cleanup at
  `use-pi-chat.ts:485-489` runs `closedByEffect = true`, `source?.close()`
  (the outer `let source` is rebound on every reconnect, so the latest
  connection is the one closed), and `if (reconnectTimer)
  clearTimeout(reconnectTimer)`. Teardown is guaranteed on unmount and on
  every dependency re-run.
- **Outcome:** waived with evidence, 2026-08-11 (authorized by user, decision
  Q6). Review condition: re-verify if the reconnect logic moves outside the
  effect or `source` stops being the closure's latest binding.

## Waiver 2 — `effect-needs-cleanup` @ `packages/web-design/src/hooks/use-proximity-hover.ts:90`

- **Rule:** `react-doctor/effect-needs-cleanup` (severity: error)
- **Predicate the detector claims:** "`observe` creates a subscription in a
  function that outlives the render, with no cleanup path."
- **Observed evidence (read):** observer handles are registry-managed in
  `itemObserversRef`: `registerItem` disconnects and deletes the previous
  observer for an index before creating a new one
  (`use-proximity-hover.ts:81-84`), and an unmount `useEffect` disconnects
  every observer then clears the registry (`:175-186`). A second container
  observer is released at `:172`.
- **Outcome:** waived with evidence, 2026-08-11 (authorized by user, decision
  Q6). Review condition: re-verify if the per-index registry or the unmount
  effect is removed.
