import { ProjectIdSchema } from "@prime-agent/web-protocol";
import { getPrimeConfig } from "../prime-config";
import { listSessionRows } from "../session-list";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

/** Read-only session summaries, optionally filtered to an active project. */
export function handleChatSessionsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const requestedProjectId = new URL(request.url).searchParams.get("projectId");
		const projectId = requestedProjectId ? ProjectIdSchema.parse(requestedProjectId) : undefined;
		const sessions = await listSessionRows(getBridge(), getPrimeConfig().projectRegistry, projectId);
		return Response.json({ sessions });
	}, request);
}
