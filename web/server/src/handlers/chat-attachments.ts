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
import { requireProjectSession } from "./session-access";

const AttachmentIdSchema = z.uuid();
const ATTACHMENT_WRITE_CONCURRENCY = 8;

function isSafeRasterImage(mimeType: string, data: Uint8Array) {
	if (mimeType === "image/png")
		return (
			data.length >= 8 &&
			data.subarray(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])
		);
	if (mimeType === "image/jpeg") return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
	if (mimeType === "image/gif") {
		const header = new TextDecoder().decode(data.subarray(0, 6));
		return header === "GIF87a" || header === "GIF89a";
	}
	return (
		mimeType === "image/webp" &&
		data.length >= 12 &&
		new TextDecoder().decode(data.subarray(0, 4)) === "RIFF" &&
		new TextDecoder().decode(data.subarray(8, 12)) === "WEBP"
	);
}

async function resolveSession(sessionId: string) {
	const bridge = getBridge();
	const session = bridge.getSession(sessionId) ?? (await bridge.resumeSessionById(sessionId));
	if (!(await requireProjectSession(session))) return undefined;
	return session;
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
	}, request);
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
		const safeRasterImage = isSafeRasterImage(attachment.metadata.mimeType, attachment.data);
		// MIME metadata is caller-asserted, so only a small set of raster formats
		// with matching byte signatures may render in the app origin. Everything
		// else (including SVG and HTML) remains an opaque download.
		return new Response(attachment.data, {
			headers: {
				"Content-Type": safeRasterImage ? attachment.metadata.mimeType : "application/octet-stream",
				...(safeRasterImage
					? {}
					: {
							"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.metadata.name)}`,
						}),
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	}, request);
}
