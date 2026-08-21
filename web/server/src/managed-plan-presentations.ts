import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChatPlanPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { ChatPlanPresentationSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { BridgeSession } from "./prime-bridge";

function root(session: BridgeSession) {
	return join(dirname(dirname(session.sessionPath)), "session-plan-presentations", session.sessionId);
}
function file(session: BridgeSession) {
	return join(root(session), "presentations.json");
}
export async function loadManagedPlanPresentations(session: BridgeSession): Promise<Array<ChatPlanPresentation>> {
	try {
		const parsed: unknown = JSON.parse(await readFile(file(session), "utf8"));
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((candidate) => {
			const result = ChatPlanPresentationSchema.safeParse(candidate);
			return result.success ? [result.data] : [];
		});
	} catch {
		return [];
	}
}
export async function upsertManagedPlanPresentation(session: BridgeSession, presentation: ChatPlanPresentation) {
	const verified = ChatPlanPresentationSchema.parse(presentation);
	const current = await loadManagedPlanPresentations(session);
	const index = current.findIndex((item) => item.assistantMessageId === verified.assistantMessageId);
	const next =
		index < 0 ? [...current, verified] : current.map((item, itemIndex) => (itemIndex === index ? verified : item));
	await mkdir(root(session), { recursive: true });
	await writeFile(file(session), JSON.stringify(next));
	return verified;
}
export async function deleteManagedPlanPresentationsForSession(sessionId: string, sessionPath: string) {
	await rm(join(dirname(dirname(sessionPath)), "session-plan-presentations", sessionId), {
		recursive: true,
		force: true,
	});
}

/**
 * Forks/duplicates carry the transcript (and its `${sessionId}-mN` indices) with
 * them; rewrite each record's canonical id for the forked session and drop
 * records whose message index no longer exists after slicing.
 */
export async function copyManagedPlanPresentationsForFork(
	source: BridgeSession,
	forked: BridgeSession,
	forkedMessageCount: number,
): Promise<void> {
	const records = await loadManagedPlanPresentations(source);
	if (records.length === 0) return;
	const sourceMarker = `${source.sessionId}-m`;
	const copied = records.flatMap((record) => {
		if (!record.assistantMessageId.startsWith(sourceMarker)) return [record];
		const index = Number.parseInt(record.assistantMessageId.slice(sourceMarker.length), 10);
		if (!Number.isInteger(index) || index >= forkedMessageCount) return [];
		return [{ ...record, assistantMessageId: `${forked.sessionId}-m${index}` }];
	});
	if (copied.length === 0) return;
	await mkdir(root(forked), { recursive: true });
	await writeFile(file(forked), JSON.stringify(copied));
}
