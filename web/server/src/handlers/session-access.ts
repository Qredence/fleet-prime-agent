import { type ProjectId, SessionIdSchema } from "@prime-agent/web-protocol";
import type { BridgeSession } from "../prime-bridge";
import { getPrimeConfig } from "../prime-config";
import { getBridge } from "../singleton";

/**
 * The HTTP access path for caller-supplied session ids. Cache hits must recheck
 * project membership: a project can be unregistered while its session is live.
 * Cold resume validates transcript metadata before attaching a daemon connection.
 * `resume: false` keeps discovery and child-transcript reads from starting one.
 * Project membership is a product restriction, not user authentication.
 */
export async function requireSession(
	sessionId: string,
	options?: { projectId?: ProjectId | null; openUI?: boolean; resume?: boolean },
): Promise<BridgeSession | undefined> {
	if (!SessionIdSchema.safeParse(sessionId).success) return undefined;
	const bridge = getBridge();
	const session =
		bridge.getSession(sessionId) ??
		(options?.resume === false
			? undefined
			: await bridge.resumeSessionById(sessionId, options?.projectId, { openUI: options?.openUI }));
	if (!session?.projectId || (options?.projectId && session.projectId !== options.projectId)) return undefined;
	try {
		await getPrimeConfig().projectRegistry.get(session.projectId);
	} catch {
		return undefined;
	}
	return session;
}
