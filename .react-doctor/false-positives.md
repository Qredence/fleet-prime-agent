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

## Waiver 3 — `no-multi-comp` @ `packages/web-design/src/components/openui/charts.tsx`

- **Rule:** `react-doctor/no-multi-comp` (severity: warning).
- **Predicate the detector claims:** the two chart components should be split
  across separate files.
- **Observed evidence (read):** `LineChartDef` and `DonutChartDef` are the
  focused chart pair in the approved OpenUI Wave-1 architecture. They share
  the same Recharts primitives, no-data behavior, and `CHART_FALLBACK_COLORS`
  convention; the module is dedicated to their definitions rather than being
  a general component grab-bag.
- **Outcome:** waived with evidence, 2026-08-11. Review condition: re-evaluate
  if a third independent chart family or unrelated UI component is added to
  `charts.tsx`.

## Waiver 4 — `no-loading-flag-reset-outside-finally` @ `packages/web-design/src/components/fleet-pi/pi/workspace-panel.tsx:161`

- **Rule:** `react-doctor/no-loading-flag-reset-outside-finally` (severity:
  warning).
- **Predicate the detector claims:** `previewLoading` can remain true when
  `loadWorkspaceFile` rejects.
- **Observed evidence (read):** `loadPreview` starts at
  `workspace-panel.tsx:149`, resets `previewError`, and wraps
  `await loadWorkspaceFile(selectedPath)` in `try`/`catch`/`finally`. The
  `finally` at `:161` calls `setPreviewLoading(false)` after both paths,
  unless the effect has been cancelled by cleanup. This guard prevents a stale
  request from changing state after its selection changes.
- **Outcome:** waived with evidence, 2026-08-11. Review condition: re-verify
  if the reset moves out of `finally` or cancellation semantics change.
