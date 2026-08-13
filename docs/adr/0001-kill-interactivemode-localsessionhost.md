# Kill the InteractiveModeLocalSessionHost bypass

`InteractiveModeLocalSessionHost` was a documented "legacy" backdoor (`interactive-mode-services.ts`) exposing raw `AgentSession`, `SessionManager`, and `ExtensionRunner` plus `runtimeHost.session.agent.signal` to terminal UI code whenever the connection was in-process. Every feature built through the host silently became daemon-incompatible, and the `AgentConnection` contract was being undercut from the inside.

We deleted the host entirely. The gap is closed by widening `AgentConnection` with: an `extensions` sub-interface (completions, diagnostics, shortcuts, message/tool renderers, `bindExtensions`), a read-only `SessionView`, and an `afterReplace` hook with a narrow `ReplacedClientContext` (sendUserMessage/notify/setEditorText) replacing the old `withSession`/`setup` hooks for portable clients. `seedMessages` on `new_session` is wire-supported at `DAEMON_PROTOCOL_VERSION` 8. The extension surface (executable callbacks), `getAbortSignal`, `getReadonlySessionManager`, `getSystemPromptSync`, and `setup`/`withSession` remain permanently process-local — daemon adapters throw `AgentConnectionUnsupportedError`. Dual-compat tests cover new-client/old-daemon and old-client/new-daemon for `seedMessages` per `AGENTS.md`.

## Considered options

- **Keep the host, document it as "in-process only"** — rejected: it had already produced many call sites in one file and `session.agent.transport =` direct writes from the daemon; "document-only" had not worked.
- **Extend existing AgentConnection methods with optional params** — rejected: would have hidden process-local operations (extension introspection) inside uniformly wire-capable calls, making caller intent opaque.
- **Invent wire shapes for executable callbacks** — rejected: keyboard shortcut handlers, message/tool renderers, and `bindExtensions` cannot serialize across the daemon socket without a different product contract.

## Consequences

- Portable clients use `AgentConnection` for session ownership and `seedMessages`/`afterReplace` for new-session seeding and post-swap hooks.
- Process-local extension members stay in-process; InteractiveMode degrades gracefully on daemon transports via `tryExtensionSurface`.
- The wire protocol is at version 8 (schema revision 15) for `seedMessages`; clients speaking v7 must not send that field.
- `createFakeAgentConnection(overrides)` (throws on unstubbed methods) remains the supported way to test InteractiveMode against the seam.
- `interactive-mode-boundary.test.ts` asserts behavior (boundary-awareness) in addition to imports.
