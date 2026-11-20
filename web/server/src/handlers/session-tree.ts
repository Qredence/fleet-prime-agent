import {
	SessionTreeNavigateRequestSchema,
	SessionTreeNavigateResponseSchema,
	SessionTreeSnapshotResponseSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { SessionTreeBusyError, SessionTreeCancelledError, SessionTreeConcurrencyError } from "../session-tree-mapper";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import { requireSession } from "./session-access";

/**
 * Reads the browser-safe session tree snapshot for a live session.
 */
export function handleChatSessionTreeGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const sessionId = url.searchParams.get("sessionId");
		if (!sessionId) {
			return Response.json({ message: "GET /api/chat/session-tree requires ?sessionId=" }, { status: 400 });
		}
		const parsedSessionId = SessionIdSchema.safeParse(sessionId);
		if (!parsedSessionId.success) {
			return Response.json({ message: "Invalid session id" }, { status: 400 });
		}
		const session = await requireSession(parsedSessionId.data);
		if (!session) return Response.json({ message: `Unknown session: ${parsedSessionId.data}` }, { status: 404 });
		const snapshot = await getBridge().readSessionTreeSnapshot(parsedSessionId.data);
		return Response.json(SessionTreeSnapshotResponseSchema.parse({ snapshot }));
	}, request);
}

/**
 * Navigates the live session tree to an earlier entry and returns the authoritative snapshot.
 */
export function handleChatSessionTreeNavigatePost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = SessionTreeNavigateRequestSchema.parse(await request.json().catch(() => ({})));
		const session = await requireSession(body.sessionId);
		if (!session) return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
		if (session.isStreaming) {
			return Response.json({ message: new SessionTreeBusyError().message }, { status: 409 });
		}
		try {
			const snapshot = await getBridge().navigateSessionTree(
				body.sessionId,
				body.targetEntryId,
				body.expectedLeafId,
			);
			return Response.json(SessionTreeNavigateResponseSchema.parse({ snapshot }));
		} catch (error) {
			if (error instanceof SessionTreeConcurrencyError || error instanceof SessionTreeCancelledError) {
				return Response.json({ message: error.message }, { status: error.status });
			}
			throw error;
		}
	}, request);
}
