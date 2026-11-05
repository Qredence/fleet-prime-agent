/**
 * Fleet's connection port to a Prime Agent session.
 *
 * This is the seam `web/server` programs against. It is intentionally narrower
 * than the upstream SDK's `AgentConnection`, which declares ~86 methods for the
 * terminal client while Fleet calls 28. Implementing the other 58 as throws
 * would put unverified code on the production path, so the port states exactly
 * what Fleet uses and the adapter is checked against it.
 *
 * Signatures come from the upstream interface by indexed access: the SDK does
 * not export most of its supporting types from the package root, and restating
 * them here would let the two drift. The type itself is reached through
 * `legacy/prime-agent-sdk.ts`, the single module allowed to import the SDK.
 */
import type { LegacyAgentConnection as AgentConnection } from "./legacy/prime-agent-sdk";

type Port<T extends keyof AgentConnection> = AgentConnection[T];
type PortEvent = Parameters<Port<"subscribe">>[0] extends (event: infer E) => unknown ? E : never;
export type SnapshotFor<C extends FleetAgentConnection> = Awaited<ReturnType<C["getInitialSnapshot"]>>;
export type MessagesFor<C extends FleetAgentConnection> = Awaited<ReturnType<C["getMessages"]>>;
export type StatsFor<C extends FleetAgentConnection> = Awaited<ReturnType<C["getSessionStats"]>>;
export type QueueFor<C extends FleetAgentConnection> = Awaited<ReturnType<C["getQueue"]>>;
export type SessionTreeFor<C extends FleetAgentConnection> = Awaited<ReturnType<C["getSessionTree"]>>;
export type StateFor<C extends FleetAgentConnection> = Awaited<ReturnType<C["getState"]>>;
export type ModelFor<C extends FleetAgentConnection> = Awaited<ReturnType<C["setModel"]>>;
export type WatcherFor<C extends FleetAgentConnection> = Awaited<ReturnType<C["watchSession"]>>;

/**
 * Connection events a Fleet connection can emit.
 *
 * Two shapes reach the bridge. The in-process test adapter emits the SDK's
 * fully-typed union; the daemon adapter emits the same discriminators with
 * wire-shaped payloads, because it observes JSON frames. `event-mapper` is the
 * boundary that narrows either into Fleet's protocol types, so both are
 * accepted here instead of forcing a cast at one adapter or the other.
 */
export type FleetConnectionEvent =
	| PortEvent
	| { type: "session_event"; event: Record<string, unknown> }
	| { type: "session_replaced"; state: Record<string, unknown>; messages: unknown[] }
	| { type: "session_resynced"; snapshot: Record<string, unknown> }
	| {
			type: "connection_status";
			status: "reconnecting" | "connected";
			error?: string;
			daemonVersion?: string;
	  }
	| { type: "heartbeats_changed" }
	| { type: "closed"; error?: string };

export type FleetConnectionListener = (event: FleetConnectionEvent) => void | Promise<void>;

export type FleetAgentConnection = {
	abort: Port<"abort">;
	deleteSavedSession: Port<"deleteSavedSession">;
	dispose: Port<"dispose">;
	exportToHtml: Port<"exportToHtml">;
	exportToJsonl: Port<"exportToJsonl">;
	fork: Port<"fork">;
	getInitialSnapshot: Port<"getInitialSnapshot">;
	getMessages: Port<"getMessages">;
	getQueue: Port<"getQueue">;
	getSessionStats: Port<"getSessionStats">;
	getSessionTree: Port<"getSessionTree">;
	getState: Port<"getState">;
	getSystemPrompt: Port<"getSystemPrompt">;
	mutateQueuedMessage: Port<"mutateQueuedMessage">;
	navigateTree: Port<"navigateTree">;
	onBeforeSessionInvalidate: Port<"onBeforeSessionInvalidate">;
	promptAndWait: Port<"promptAndWait">;
	reload: Port<"reload">;
	setModel: Port<"setModel">;
	setServiceTier: Port<"setServiceTier">;
	setSessionName: Port<"setSessionName">;
	setThinkingLevel: Port<"setThinkingLevel">;
	subscribe(listener: FleetConnectionListener): () => void;
	waitForIdle: Port<"waitForIdle">;
	watchSession: Port<"watchSession">;
};
