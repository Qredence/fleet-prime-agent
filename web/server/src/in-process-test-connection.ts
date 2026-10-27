/**
 * Legacy SDK-bound integration adapter for PrimeBridge tests.
 *
 * Keep this for tests that deliberately exercise installed Prime Agent SDK
 * session behavior. Bridge contract tests should use the deterministic
 * test-only AgentConnection fixture instead.
 */

import { join } from "node:path";
import type { AgentSession, CreateAgentSessionRuntimeFactory } from "prime-agent";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	InProcessAgentConnection,
	SessionManager,
} from "prime-agent";
import { resolveAgentDir } from "./agent-dir";
import type { WebAgentConnection, WebAgentConnectionOptions } from "./daemon-runtime";
import { createLegacyAuthStorage } from "./legacy/prime-agent-sdk";

export async function createInProcessTestAgentConnection(
	options: WebAgentConnectionOptions,
): Promise<WebAgentConnection & { session: AgentSession }> {
	const agentDir = resolveAgentDir();
	const authStorage = createLegacyAuthStorage(join(agentDir, "auth.json"));
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
		agentDir,
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
