# Kill the InteractiveModeLocalSessionHost bypass

`InteractiveModeLocalSessionHost` was a documented "legacy" backdoor (`interactive-mode-services.ts:43-110`) exposing raw `AgentSession`, `SessionManager`, and `ExtensionRunner` plus `runtimeHost.session.agent.signal` to terminal UI code whenever the connection was in-process. Every feature built through the host silently became daemon-incompatible, and the 75-method `AgentConnection` contract was being undercut from the inside.

We decided to remove the host entirely. The gap is closed by widening `AgentConnection` with: an `extensions` sub-interface (completions, diagnostics, shortcuts, message renderers, `bindExtensions`), a read-only `SessionView`, and an `afterReplace` hook with a narrow `ReplacedClientContext` (sendUserMessage/notify/setEditorText) replacing the old `withSession`/`setup` hooks. This requires a `DAEMON_PROTOCOL_VERSION` 7→8 bump — new wire commands for the extension surface and `seedMessages` on `new_session` — and dual-compat tests per `AGENTS.md`.

## Considered options

- **Keep the host, document it as "in-process only"** — rejected: it had already produced 13 call sites in one file and `session.agent.transport =` direct writes from the daemon; "document-only" had not worked.
- **Extend existing AgentConnection methods with optional params** — rejected: would have hidden process-local operations (extension introspection) inside uniformly wire-capable calls, making caller intent opaque.
- **Delete without replacement** — rejected: `getArgumentCompletions`, diagnostics, shortcuts, message renderers have no existing wire equivalent.

## Consequences

- New ClientConnection methods are only implemented by the daemon; in-process and daemon clients now share one path.
- The wire protocol is at version 8; clients speaking v7 must not use the extension surface.
- `createFakeAgentConnection(overrides)` (throws on unstubbed methods) becomes the supported way to test InteractiveMode against the seam.
- `interactive-mode-boundary.test.ts` now asserts behavior (boundary-awareness) in addition to imports.
