import {
	SessionTreeNavigateRequestSchema,
	SessionTreeNavigateResponseSchema,
	SessionTreeSnapshotResponseSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { SessionTreeBusyError, SessionTreeCancelledError, SessionTreeConcurrencyError } from "../session-tree-errors";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import { requireProjectSession } from "./session-access";

async function requireWritableSession(sessionId: string) {
	const bridge = getBridge();
	const session = bridge.getSession(sessionId) ?? (await bridge.resumeSessionById(sessionId));
	if (!(await requireProjectSession(session))) {
		return {
			ok: false as const,
			response: Response.json({ message: `Unknown session: ${sessionId}` }, { status: 404 }),
		};
	}
	if (session?.isStreaming) {
		return {
			ok: false as const,
			response: Response.json({ message: new SessionTreeBusyError().message }, { status: 409 }),
		};
	}
	return { ok: true as const, session };
}

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
		const access = await requireWritableSession(parsedSessionId.data);
		if (!access.ok) return access.response;
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
		const access = await requireWritableSession(body.sessionId);
		if (!access.ok) return access.response;
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
