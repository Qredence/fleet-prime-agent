import { WorkspaceRootRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { getPrimeConfig } from "../prime-config";
import { resolveWorkspaceRootPath } from "../workspace-root";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleWorkspaceRootPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = WorkspaceRootRequestSchema.parse(raw);
		const resolved = await resolveWorkspaceRootPath(body.path);
		if (resolved.kind === "error") {
			return Response.json({ message: resolved.message }, { status: resolved.status });
		}
		getPrimeConfig().setDefaultCwd(resolved.root);
		return Response.json({ root: getPrimeConfig().defaultCwd });
	});
}
