# React Doctor cleanup

This workspace is scanned with the pinned `react-doctor@0.9.11` release. The
scope is `web/`; `packages/` is intentionally outside this audit.

## Baseline and final result

The initial 382-file scan reported 240 diagnostics: 13 errors, 227 warnings,
and a score of 49/100. Correcting the configuration paths from package-local
paths to `app/...` and `design/...` produced the evidence-backed baseline of
200 diagnostics: 11 errors, 189 warnings, and 57/100.

The final full and changed-scope scans both report zero diagnostics, zero
errors, and 100/100:

```sh
npx -y react-doctor@0.9.11 --project web --json
npx -y react-doctor@0.9.11 --project web --scope files --base HEAD --include-untracked --json
```

The final score is the result of code fixes plus only the documented waivers
in the repository's `doctor.config.jsonc`; no error-level diagnostic is waived.

## Implemented fixes

- Added stable `aria-controls`/popup `id` wiring between `ModelSelector` and
  its Popover.
- Moved OAuth callback/provider synchronization into effects and guarded async
  results with generation, login-id, and stopped checks.
- Added one shared lazy Motion runtime with `m` and `domMax`; converted layout
  motion to transforms/layout animation and retained reduced-motion behavior.
- Kept `EventSource`, `ResizeObserver`, animation-frame, timer, and portal
  teardown paths; regression tests cover the cleanup paths.
- Split the large AI sidebar, message scroller, settings dialog, Fleet Pi input
  bar, ProjectFolder overlay, and Fleet session sidebar into focused views and
  hooks. Fleet sidebar state is owned by a typed reducer.
- Hoisted stable empty defaults, memoized constructed values, and used effect
  events for the message scroller's observer callbacks.
- Preserved attachment ordering while parallelizing independent uploads and
  metadata reads; parallelized independent project/settings/workspace reads.
- Migrated safe schemas to Zod v4 formats, used `toSorted`, and added
  `trustPolicy: no-downgrade` to `web/pnpm-workspace.yaml`.
- Removed only the confirmed private app query export; package-addressable
  design exports and reserved UI files remain intact.

## Evidence-backed exceptions

The config documents the exact file/rule pairs for:

- controlled/uncontrolled disclosure and status-transition effects;
- directory loading and active-project expansion owned by the sidebar reducer;
- the dynamic `AISidebar`/`FleetSessionSidebar` render-prop API, which carries
  item-specific state and actions;
- OAuth polling cancellation guards;
- combobox collision-side and keyboard-highlight synchronization;
- ProjectFolder's custom portal modal, which implements `role=dialog`,
  `aria-modal`, Escape handling, focus wrapping, and body-scroll restoration;
- public component exports available through `web/design` wildcard exports;
- reserved/future picker, stop-control, context-menu, and project-folder files;
- OpenUI's static-render registry and chart co-location;
- the CSS `animate-in` check-icon keyframe utility, which is limited to
  opacity/transform and is not a source-level `transition-all`.

EventSource and proximity-hover ResizeObserver waivers remain because their
registries own disconnect/reconnect lifecycle and unmount cleanup; focused
tests verify the browser-facing teardown behavior.

## Verification

Focused tests:

```sh
cd web/app && node_modules/.bin/vitest run \
  src/lib/pi/react-doctor-regressions.test.tsx \
  src/lib/pi/session-sidebar.test.tsx

cd web/server && node_modules/.bin/vitest run \
  src/__tests__/chat-attachments-handler.test.ts \
  src/__tests__/chat-settings-handler.test.ts \
  src/__tests__/managed-attachments.test.ts
```

The app/design/server TypeScript projects are checked directly with their
workspace `tsc --noEmit` projects. The OpenUI message-identity and render
harness checks, source-installer check, and static browser-smoke check also
pass.

`npm run check` was run, but it stops before TypeScript because the shell
resolves a Homebrew Biome 2.5.3 binary while the repository configuration is
pinned to Biome 2.3.5. Its `--write` phase touched unrelated package files;
those collateral edits were restored, and the configured local Biome binary
checks all 1,102 files clean. The repository-wide TypeScript phase still has
pre-existing `packages/` errors involving optional headers and unavailable
example dependencies, so it was not changed as part of this `web/` cleanup.

`npm run check:web` and the pnpm-backed rendering command are blocked by the
requested `trustPolicy: no-downgrade` policy rejecting the existing lockfile
entries `@pierre/theme@2.0.0` and `semver@6.3.1`. The web package typechecks
pass directly, and the rendering harness passes when invoked directly.

Live browser smoke on `http://127.0.0.1:3000/` verified project collapse and
keyboard toggling without changing the URL or opening a chat, model Popover
ARIA target identity, and reduced-motion toggling. A fresh tab had zero
console errors; deliberate reduced-motion emulation produced only Motion's
expected advisory warning.
