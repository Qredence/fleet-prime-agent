# Prime Agent

A self-improving RLM (Recursive Language Model) agent. Terminal clients, the headless daemon, and the web adapter all drive the same core session runtime through a single typed connection seam.

## Language

### Connection & boundary

**AgentConnection**:
The single client-side seam between any front end (terminal, RPC, web) and the agent runtime. All session state, event streams, and commands flow through this interface — never directly to `AgentSession` or its internal managers.
_Avoid_: host, bridge (except historical), direct session access

**extensions** (sub-interface on AgentConnection):
The narrow projection of extension-runtime surface (argument completions, diagnostics, shortcuts, message renderers, `bindExtensions`) exposed to clients. Process-local by nature; kept behind its own group on `AgentConnection` so the top-level seam stays small.
_Avoid_: ExtensionRunner (the runtime-internal implementation name), "host" API

**SessionView**:
Read-only, serializable projection of `AgentSession` — cwd, session dir, header, context-tree walks, and session-file materialization. Deliberately excludes mutation and anything that needs the live `SessionManager` or `ExtensionRunner`.
_Avoid_: SessionManager (implementation), Session, Host

**ReplacedClientContext**:
The narrow surface given to `afterReplace` hooks after `newSession`/`fork`/`switchSession` swaps the underlying session. Exposes: `sendUserMessage`, `notify`, `setEditorText`. Nothing else is permitted to cross the seam.
_Avoid_: withSession, setup hook, session replacement

**afterReplace**:
The single supported shape for client-side work that must run immediately after a session swap. An explicit, typed hook on the connection methods — not a raw `AgentSession` reference — so daemon-backed clients can queue it over the wire.
_Avoid_: withSession (legacy), setup, seed hook

**seedMessages**:
The supported way to populate a freshly-created session with initial user/assistant messages without a raw session handle. Passed to `newSession` as part of the client-visible options bag.
_Avoid_: setup, bootstrap, new-session script

### Anti-terms (removed from the language)

**InteractiveModeLocalSessionHost** (retired):
Former backdoor exposing raw `AgentSession`, `SessionManager`, and `ExtensionRunner` to terminal UI code under the guise of "in-process convenience". Deleted because every method on it bypassed the seam and produced daemon-incompatible features.
_Avoid_: local host, host services, legacy bridge
