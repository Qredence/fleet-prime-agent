import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import { z } from "zod";
import { getPrimeConfig } from "../prime-config";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const BodySchema = z.object({
	cwd: z.string().min(1).optional(),
	model: z.unknown().optional(),
	thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
});

function toThinkingLevel(level: ChatThinkingLevel | undefined): ThinkingLevel | undefined {
	return level;
}

export function handleChatNewPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const bridge = getBridge();
		void bridge.ensureKernelReady().catch(() => {
			/* backgrounded; failures surface when ipython is invoked */
		});

		const raw = await request.json().catch(() => ({}));
		const body = BodySchema.parse(raw);
		const session = await bridge.createSession({
			cwd: body.cwd ?? getPrimeConfig().defaultCwd,
			model: body.model,
			thinkingLevel: toThinkingLevel(body.thinkingLevel),
		});
		return Response.json({
			session: {
				sessionId: session.sessionId,
				sessionFile: session.sessionPath,
				cwd: session.cwd,
			},
			messages: [],
		});
	});
}
