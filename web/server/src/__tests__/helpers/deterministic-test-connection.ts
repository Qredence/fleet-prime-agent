import { basename, extname } from "node:path";
import type { AgentConnection, AgentConnectionEvent, AgentConnectionState } from "prime-agent";
import type { WebAgentConnection, WebAgentConnectionOptions } from "../../daemon-runtime";

type AgentSnapshot = Awaited<ReturnType<AgentConnection["getInitialSnapshot"]>>;
type SessionTree = Awaited<ReturnType<AgentConnection["getSessionTree"]>>;

export type DeterministicTestAgentConnection = WebAgentConnection & {
	testControls: {
		emit(event: AgentConnectionEvent): void;
		listenerCount(): number;
	};
};

/**
 * A deterministic AgentConnection double for Fleet bridge contract tests.
 * It has no session manager, provider, extension host, or transcript writer.
 * Tests that need execution-engine behavior should use recorded daemon fixtures
 * or the explicitly named legacy integration adapter.
 */
export function createDeterministicTestAgentConnection(
	options: WebAgentConnectionOptions,
	fixture: {
		sessionId?: string;
		messages?: AgentSnapshot["messages"];
		sessionTree?: SessionTree;
		forkToNewSession?: WebAgentConnection["forkToNewSession"];
		onSetModel?: (provider: string, modelId: string) => void;
		onSetThinkingLevel?: (level: AgentConnectionState["thinkingLevel"]) => void;
		onSetServiceTier?: (tier: AgentConnectionState["serviceTier"]) => void;
		state?: Partial<AgentConnectionState>;
	} = {},
): DeterministicTestAgentConnection {
	const sessionId =
		fixture.sessionId ??
		(options.sessionPath ? basename(options.sessionPath, extname(options.sessionPath)) : "test-session");
	const sessionFile = options.sessionPath ?? `${options.cwd}/.fleet-test/${sessionId}.jsonl`;
	const state = {
		cwd: options.cwd,
		sessionId,
		sessionFile,
		thinkingLevel: "off",
		serviceTier: "default",
		availableThinkingLevels: ["off", "low", "medium", "high", "xhigh"],
		isStreaming: false,
		isCompacting: false,
		isBashRunning: false,
		retryAttempt: 0,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
		leafId: null,
		autoCompactionEnabled: false,
		messageCount: fixture.messages?.length ?? 0,
		sessionActions: { queuedCount: 0, steering: [], followUps: [] },
		compactionCount: 0,
		goal: { status: "idle" },
		scopedModels: [],
		activeToolNames: [],
		contextUsage: { tokens: 0, contextWindow: 0, percent: 0 },
		...fixture.state,
	} as AgentConnectionState;
	const messages = [...(fixture.messages ?? [])];
	const listeners = new Set<(event: AgentConnectionEvent) => void>();
	const connection = {
		async getState() {
			return state;
		},
		async getMessages() {
			return messages;
		},
		async getInitialSnapshot() {
			return { state, messages, ...(fixture.sessionTree ? { sessionTree: fixture.sessionTree } : {}) };
		},
		subscribe(listener: (event: AgentConnectionEvent) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async getSessionTree() {
			return fixture.sessionTree ?? { tree: [], leafId: state.leafId };
		},
		async getSessionHeader() {
			return { type: "session" as const, id: sessionId, timestamp: new Date(0).toISOString(), cwd: options.cwd };
		},
		async getQueue() {
			return { steering: [], followUps: [] };
		},
		async getSystemPrompt() {
			return "";
		},
		async getSessionStats() {
			return state.contextUsage;
		},
		async waitForIdle() {},
		async promptAndWait() {},
		async abort() {},
		async setModel(provider: string, modelId: string) {
			fixture.onSetModel?.(provider, modelId);
		},
		async setThinkingLevel(level: AgentConnectionState["thinkingLevel"]) {
			state.thinkingLevel = level;
			fixture.onSetThinkingLevel?.(level);
		},
		async setServiceTier(tier: AgentConnectionState["serviceTier"]) {
			state.serviceTier = tier;
			fixture.onSetServiceTier?.(tier);
		},
		async setSessionName(name: string) {
			state.sessionName = name;
		},
		async navigateTree() {
			return { cancelled: false };
		},
		async exportToJsonl(path: string) {
			return path;
		},
		async exportToHtml(path: string) {
			return path;
		},
		async dispose() {
			listeners.clear();
		},
	} as unknown as AgentConnection;
	return {
		connection,
		openUIPrompt: options.openUIPrompt,
		setOpenUIPrompt() {},
		forkToNewSession:
			fixture.forkToNewSession ??
			(async (_entryId, _position) => ({
				cancelled: false,
				sessionPath: `${options.cwd}/.fleet-test/${sessionId}-fork.jsonl`,
			})),
		testControls: {
			emit(event) {
				for (const listener of listeners) listener(event);
			},
			listenerCount() {
				return listeners.size;
			},
		},
	};
}
