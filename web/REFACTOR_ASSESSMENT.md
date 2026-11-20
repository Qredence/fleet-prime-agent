# Web refactor assessment

Measured on `implementation/web-frontend-simplify-eba1` before this pass’s deletions. Counts are `.ts`/`.tsx` lines.

## Size map

| Tree                     | Files |  Lines |                               Production |  Tests |
| ------------------------ | ----: | -----: | ---------------------------------------: | -----: |
| `web/app/src`            |   380 | 65,205 |                                        — |      — |
| `web/app/src/components` |   188 | 37,424 |                                   30,751 |  6,673 |
| `web/app/src/hooks`      |    51 | 13,587 |                                    9,756 |  3,831 |
| `web/app/src/lib`        |    94 | 10,166 |                                    7,321 |  2,845 |
| `web/app/src/routes`     |    41 |    965 | route modules, mostly one-line delegates |      — |
| `web/server/src`         |   185 | 38,060 |                                   19,859 | 18,201 |
| `web/protocol/src`       |    31 |  5,114 |                                    4,334 |    780 |

### `web/app/src/lib` (production lines)

| Folder                            | Lines | Job                                                                    |
| --------------------------------- | ----: | ---------------------------------------------------------------------- |
| `chat/`                           | 2,914 | HTTP client, stream reducer, slash-command port, plan/session helpers  |
| `fluid/`                          |   907 | Motion tokens, size/shape/surface React contexts for the design system |
| `tools/`                          |   626 | Turn tool-call payloads into diff/todo/citation/output views           |
| `settings/`                       |   597 | Settings section registry and draft mapping                            |
| `openui/`                         |   573 | OpenUI program split, repair text, client tool calls                   |
| root                              |   576 | Storage, theme, notify, query client, URL safety                       |
| `sessions/`                       |   393 | Sidebar tree types and transcript summaries                            |
| `artifacts/`, `workspace/`, other |  ~700 | Artifact extraction, path navigation                                   |

### `web/app/src/hooks` (production lines)

| Folder       | Lines | Job                                                                                      |
| ------------ | ----: | ---------------------------------------------------------------------------------------- |
| `chat/`      | 6,042 | Session state, SSE, send/stream, slash actions, composer assist, workspace orchestration |
| root         | 1,222 | Fluid hover measurement (`use-fluid-hover` 675) and input helpers                        |
| `settings/`  |   981 | Provider credential and settings form controllers                                        |
| `layout/`    |   767 | Shell state and right-panel context assembly                                             |
| `sessions/`  |   576 | Sidebar, agent tabs, session tree                                                        |
| `workspace/` |   168 | Split pane widths                                                                        |

### Largest files

| Lines | File                                            | User-facing job                     |
| ----: | ----------------------------------------------- | ----------------------------------- |
| 2,290 | `web/server/src/__tests__/prime-bridge.test.ts` | Bridge behavior contract            |
| 2,183 | `web/server/src/__tests__/event-mapper.test.ts` | Daemon frame → chat event contract  |
| 1,671 | `web/server/src/event-mapper.ts`                | Map daemon frames to browser events |
| 1,420 | `web/server/src/prime-bridge.ts`                | Session lifecycle, replay, sidecars |
| 1,382 | `web/app/src/components/ui/slider.tsx`          | Range control (rewritten this pass) |
| 1,170 | `use-pi-chat-messaging.test.tsx`                | Send/queue/recovery behavior        |
| 1,158 | `use-pi-chat-stream.ts`                         | SSE replay and POST streaming       |
| 1,025 | `daemon-runtime.ts`                             | Spawn and supervise the Rust daemon |
|   956 | `openui-library.tsx`                            | OpenUI component catalog            |
|   846 | `use-pi-chat.ts`                                | Chat state the shell reads          |

## What a chat UI over Prime Agent actually needs

Browser: a transcript, a composer, a session list, settings for the runtime the daemon already exposes, and a typed HTTP/SSE client.

Server: accept those HTTP calls, speak protocol 7 to the Rust daemon, and sanitize what the browser may see.

Shared package: the request and event schemas both sides validate.

## Over-engineering (explicit)

1. **Design-system engines inside primitives.** `slider.tsx` was a 1,300-line motion/pip engine for two call sites (effort picker, OpenUI). `use-merge-split.tsx` (427 lines) existed only to animate a merged selection pill in `Table`. Hover measurement in `use-fluid-hover.ts` (675 lines) is a custom hit-tester with gap-click, nearest-item, and a subscription store so list rows do not re-render together. A chat UI needs focus and hover styles, not a layout engine.

2. **Chat state is a cluster of coordinated hooks and refs, not one reducer.** `usePiChat` owns a dozen refs and setters, `usePiChatStream` applies SSE frames by hand _and_ calls `applyChatStreamEvent` for the POST stream, and `useChatWorkspaceData` stitches actions, slash commands, and panel context into one object the shell immediately destructures. Recovery (`forbidden-session-recovery`, SSE cursor store, stream admission promises) stacks three retry policies on one disconnect.

3. **A second slash-command runtime.** Removed. The menu now comes from `GET /api/chat/commands`, which asks the daemon's `get_commands` when a session is attached. The browser only opens settings, the model picker, the effort picker, and a new session itself.

4. **Parallel protocol types.** `chat-protocol.ts` is a `z.infer` mirror of `schemas/*`, and `chat-protocol.zod.ts` re-exports the same schemas for the browser bundle boundary. The split (types vs zod runtime) is justified so the browser can import schemas without pulling server code. The alias file is not a second schema, but it is a second name for every schema.

5. **One file per HTTP verb.** `web/app/src/routes/api/**` is TanStack file routing: each file calls one `web/server` handler. The handlers are the real code (~3,000 lines). Collapsing routes would fight the framework. Collapsing _server_ modules that are only `export { handleX }` indirection is future work; `index.ts` is that barrel.

6. **Registries with a fixed list.** Right-panel and settings-section registries are maps of one product’s panels, checked by a custom script. They are not a plugin system with third-party entries. Acceptable as data, not as a framework.

7. **Fluid contexts (`lib/fluid`, ~900 lines).** Size, shape, surface, and type-scale contexts exist so every primitive shares one density ladder. That is a design system, not chat logic. Removing it means rewriting `components/ui`. Not done in this pass because it would restyle the product.

## Target architecture

Keep three packages. The browser must not import the daemon client; that is the security boundary, not accidental layering.

- **`web/protocol`**: Zod schemas are the source of truth. Export inferred types from the schema modules. Drop the hand-maintained alias file when imports are updated.
- **`web/server`**: `daemon-runtime` + `fleet-daemon-connection` + `prime-bridge` + `event-mapper`, then handlers grouped by resource (`chat`, `projects`, `workspace`, `settings`) instead of one module per route. OpenUI prompt generation, TypeSafe intent, and the legacy read-only SDK bridge stay as features until the daemon replaces the cold reads.
- **`web/app`**: one `useChat` that owns messages, status, and the stream reducer; SSE and POST both call that reducer. Components for transcript, composer, sessions, and settings own their local state. `lib/` keeps the fetch client, tool-output normalization, and OpenUI parsing — not a second command runtime and not a layout engine. Primitives stay thin wrappers over Base UI.

## Completed after the size map

1. SSE replay and POST streaming both call `applyChatStreamEvent`. Reconnect cursors and agent-settled hydration stay as effects.
2. Slash commands come from the runtime endpoint. `update`, `fullscreen`, `quit`, and `traces` are not offered.
3. `use-fluid-hover.ts` and the measured highlight overlay are gone. Select, table, and breadcrumbs use CSS hover.

| Area | At the size map | Now |
| --- | ---: | ---: |
| `hooks/` | 13,587 | 11,768 |
| `lib/` | 10,166 | 9,765 |
| `components/` | 37,424 | 35,701 |
| `server/src` | 38,060 | 38,100 |
| `protocol/src` | 5,114 | 5,114 |
| `web/app/src` | 65,205 | 60,117 |

Fluid size and shape contexts remain. They are the density ladder for the primitives, not the hover hit-tester.
