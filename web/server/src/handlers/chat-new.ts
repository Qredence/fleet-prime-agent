import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import { ChatNewRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { getPrimeConfig } from "../prime-config";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

function toThinkingLevel(level: ChatThinkingLevel | undefined): ThinkingLevel | undefined {
	return level;
}

export function handleChatNewPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const bridge = getBridge();
		const registry = getPrimeConfig().projectRegistry;
		const raw = await request.json().catch(() => ({}));
		const body = ChatNewRequestSchema.parse(raw);
		const projectId =
			body.projectId ??
			(await registry.projectIdForCwd(getPrimeConfig().defaultCwd)) ??
			(await registry.register(getPrimeConfig().defaultCwd)).projectId;
		const project = await registry.get(projectId);
		void bridge.ensureKernelReady(project.canonicalPath).catch(() => {
			/* backgrounded; failures surface when ipython is invoked */
		});

		const session = await bridge.createSession({
			cwd: project.canonicalPath,
			projectId,
			thinkingLevel: toThinkingLevel(body.thinkingLevel),
			mode: body.mode,
		});
		if (body.model) {
			await bridge.setModel(session.sessionId, body.model);
			const thinking = body.model.thinkingLevel ?? body.thinkingLevel;
			if (thinking) {
				session.session.setThinkingLevel(toThinkingLevel(thinking)!);
			}
		}
		return Response.json({
			session: {
				sessionId: session.sessionId,
				projectId,
			},
			messages: [],
			planPresentations: [],
			presentation: bridge.getPresentation(session.sessionId),
		});
	});
}
