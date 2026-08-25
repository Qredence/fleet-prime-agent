/**
 * AgentConnection runtime shims.
 *
 * `InProcessAgentConnection` is constructed over an `AgentSessionRuntime`. In
 * production the bridge obtains that runtime via `createAgentSessionRuntime(...)`
 * so new/switch/fork/import replace the active session correctly. In tests we
 * already have a real `AgentSession` from `createWebAgentSession`; wrapping it
 * in a no-op `AgentSessionRuntime` lets us exercise the connection seam without
 * re-running the runtime factory.
 *
 * Mirrors `packages/coding-agent/test/suite/acp-features.test.ts:54-62`.
 */
import type { AgentSession, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Build a minimal `AgentSessionRuntime` host around an existing `AgentSession`.
 * Only the surface that `InProcessAgentConnection` actually touches is
 * populated; the rest are no-ops because this shim is for tests that drive a
 * single session directly and never trigger runtime replacement.
 */
export function runtimeHostFor(session: AgentSession): AgentSessionRuntime {
	return {
		session,
		setRebindSession() {
			/* no replacement happens in tests */
		},
		setBeforeSessionInvalidate() {
			/* tests tear down sessions directly */
		},
		async dispose() {
			await session.disposeAsync().catch(() => undefined);
		},
	} as unknown as AgentSessionRuntime;
}
