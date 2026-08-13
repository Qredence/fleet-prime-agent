import { z } from "zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const BodySchema = z.object({
	sessionId: z.string(),
	command: z.string(),
	args: z.string().optional(),
});

export function handleChatCommandPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = BodySchema.parse(await request.json().catch(() => ({})));
		const bridge = getBridge();
		const args = body.args?.trim() ?? "";

		switch (body.command) {
			case "session":
				return Response.json({
					ok: true,
					name: bridge.getSessionName(body.sessionId) ?? null,
				});
			case "name": {
				if (!args) {
					return Response.json({ message: "/name requires a display name." }, { status: 400 });
				}
				bridge.setSessionName(body.sessionId, args);
				return Response.json({ ok: true, name: args });
			}
			case "context": {
				const usage = bridge.getContextUsage(body.sessionId);
				if (!usage) {
					return Response.json({ ok: true, usage: null });
				}
				return Response.json({ ok: true, usage });
			}
			case "system-prompt":
				return Response.json({
					ok: true,
					systemPrompt: bridge.getSystemPrompt(body.sessionId),
				});
			case "export": {
				const outputPath = args || undefined;
				const result = await bridge.exportSession(body.sessionId, outputPath);
				return Response.json({ ok: true, ...result });
			}
			case "reload":
				await bridge.reloadResources(body.sessionId);
				return Response.json({ ok: true });
			case "tree": {
				if (args) {
					await bridge.navigateTree(body.sessionId, args);
				}
				const tree = bridge.getSessionTree(body.sessionId);
				return Response.json({ ok: true, tree });
			}
			case "fork": {
				if (!args) {
					return Response.json({ message: "/fork requires a message entry id in the web port." }, { status: 400 });
				}
				const result = await bridge.forkSession(body.sessionId, args, "before");
				return Response.json({ ok: true, ...result });
			}
			case "clone": {
				const tree = bridge.getSessionTree(body.sessionId);
				if (!tree.leafId) {
					return Response.json(
						{ message: "/clone requires at least one recorded entry to clone at." },
						{ status: 400 },
					);
				}
				const result = await bridge.forkSession(body.sessionId, tree.leafId, "at");
				return Response.json({ ok: true, ...result });
			}
			default:
				return Response.json({ message: `Unknown slash command: /${body.command}` }, { status: 404 });
		}
	});
}
