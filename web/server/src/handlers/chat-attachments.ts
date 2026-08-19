import { SessionIdSchema, type UploadedAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { z } from "zod/v4";
import {
	deleteManagedAttachment,
	MAX_TURN_ATTACHMENT_BYTES,
	readManagedAttachment,
	storeManagedAttachment,
} from "../managed-attachments";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const AttachmentIdSchema = z.uuid();
const ATTACHMENT_WRITE_CONCURRENCY = 8;

async function resolveSession(sessionId: string) {
	const bridge = getBridge();
	return bridge.getSession(sessionId) ?? (await bridge.resumeSessionById(sessionId));
}

export function handleChatAttachmentsPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const form = await request.formData();
		const sessionId = SessionIdSchema.parse(form.get("sessionId"));
		const files = form.getAll("files").filter((value): value is File => value instanceof File);
		if (files.length === 0) return Response.json({ message: "At least one file is required" }, { status: 400 });
		if (files.reduce((total, file) => total + file.size, 0) > MAX_TURN_ATTACHMENT_BYTES) {
			return Response.json({ message: "Attachments exceed the 100 MiB per-turn limit" }, { status: 413 });
		}
		const session = await resolveSession(sessionId);
		if (!session) return Response.json({ message: `Unknown session: ${sessionId}` }, { status: 404 });
		const settled: PromiseSettledResult<UploadedAttachment>[] = [];
		for (let index = 0; index < files.length; index += ATTACHMENT_WRITE_CONCURRENCY) {
			const chunk = files.slice(index, index + ATTACHMENT_WRITE_CONCURRENCY);
			settled.push(...(await Promise.allSettled(chunk.map((file) => storeManagedAttachment(session, file)))));
		}
		const failure = settled.find((result) => result.status === "rejected");
		if (failure) {
			// The client receives no ids on failure, so sibling writes would be
			// unreachable. Roll them back instead of leaving orphans behind.
			await Promise.all(
				settled.flatMap((result) =>
					result.status === "fulfilled" ? [deleteManagedAttachment(session, result.value.attachmentId)] : [],
				),
			);
			throw failure.reason;
		}
		const attachments = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
		return Response.json({ attachments });
	});
}

export function handleChatAttachmentGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const sessionId = SessionIdSchema.parse(url.searchParams.get("sessionId"));
		const attachmentId = AttachmentIdSchema.parse(url.searchParams.get("attachmentId"));
		const session = await resolveSession(sessionId);
		if (!session) return Response.json({ message: `Unknown session: ${sessionId}` }, { status: 404 });
		const attachment = await readManagedAttachment(session, attachmentId).catch(() => undefined);
		if (!attachment) return Response.json({ message: "Attachment not found" }, { status: 404 });
		return new Response(attachment.data, {
			headers: {
				"Content-Type": attachment.metadata.mimeType,
				"Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.metadata.name)}`,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	});
}
