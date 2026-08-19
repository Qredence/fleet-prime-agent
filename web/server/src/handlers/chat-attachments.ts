import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { z } from "zod/v4";
import { MAX_TURN_ATTACHMENT_BYTES, readManagedAttachment, storeManagedAttachment } from "../managed-attachments";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const AttachmentIdSchema = z.uuid();

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
		const attachments = await Promise.all(files.map((file) => storeManagedAttachment(session, file)));
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
