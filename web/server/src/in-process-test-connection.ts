/**
 * Explicit test adapter for PrimeBridge.
 *
 * Production sessions are daemon-backed. Keeping this adapter separate lets
 * bridge unit tests exercise the same AgentConnection contract without
 * starting a user daemon or making provider calls.
 */
import type { AgentSession, CreateAgentSessionRuntimeFactory } from "prime-agent";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	InProcessAgentConnection,
	SessionManager,
} from "prime-agent";
import type { WebAgentConnection, WebAgentConnectionOptions } from "./daemon-runtime";

export async function createInProcessTestAgentConnection(
	options: WebAgentConnectionOptions,
): Promise<WebAgentConnection & { session: AgentSession }> {
	const authStorage = AuthStorage.create();
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd,
			authStorage,
			noBuiltinHerdrReporter: true,
			telemetryDisabled: true,
			resourceLoaderOptions: {
				appendSystemPromptOverride: (base) =>
					options.openUIPrompt.enabled ? [...base, options.openUIPrompt.prompt] : base,
			},
		});
		const result = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			telemetryDisabled: true,
		});
		return {
			session: result.session,
			extensionsResult: result.extensionsResult,
			modelFallbackMessage: result.modelFallbackMessage,
			services,
			diagnostics: services.diagnostics,
		};
	};

	const sessionManager = options.sessionPath
		? await SessionManager.openAsync(options.sessionPath)
		: SessionManager.create(options.cwd);
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: options.cwd,
		agentDir: getAgentDir(),
		sessionManager,
	});
	const connection = new InProcessAgentConnection(runtime);
	let activePrompt = options.openUIPrompt.prompt;
	return {
		connection,
		session: runtime.session,
		openUIPrompt: options.openUIPrompt,
		bindUiContext: async (uiContext) => {
			await connection.bindHeadlessExtensions({ uiContext });
		},
		setOpenUIPrompt: (next) => {
			const appendSystemPrompt = runtime.session.resourceLoader.getAppendSystemPrompt();
			const currentPromptIndex = appendSystemPrompt.lastIndexOf(activePrompt);
			if (!next.enabled && currentPromptIndex >= 0) {
				appendSystemPrompt.splice(currentPromptIndex, 1);
			} else if (next.enabled && currentPromptIndex >= 0) {
				appendSystemPrompt[currentPromptIndex] = next.prompt;
			} else if (next.enabled) {
				appendSystemPrompt.push(next.prompt);
			}
			runtime.session.setActiveToolsByName(runtime.session.getActiveToolNames());
			activePrompt = next.prompt;
		},
		deleteSessionFile: (sessionPath) => connection.deleteSavedSession(sessionPath),
	};
}
