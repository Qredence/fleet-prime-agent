import type { ProjectId } from "@prime-agent/web-protocol";
import { getPrimeConfig } from "../prime-config";

/**
 * Project-membership gate for session-scoped chat handlers.
 *
 * Session ids are bearer-equivalent and enumerable via
 * `GET /api/chat/sessions`, so every handler that dereferences a
 * caller-supplied session id must confirm the session belongs to an
 * actively registered project before reading or mutating it. Single-user
 * flows are unaffected: sessions created or resumed through the bridge
 * always carry the project they were claimed by.
 *
 * NOTE (merge pass): `prime-bridge.ts` is owned by a parallel agent which
 * may add `requireProjectSession` there. This module intentionally shares
 * that name so call sites read the same; if the bridge gains the helper,
 * prefer importing it from `../prime-bridge` and delete this file.
 */
export async function requireProjectSession(
	session: { sessionId: string; projectId: ProjectId | null } | undefined,
): Promise<boolean> {
	if (!session?.projectId) return false;
	try {
		await getPrimeConfig().projectRegistry.get(session.projectId);
	} catch {
		return false;
	}
	return true;
}
