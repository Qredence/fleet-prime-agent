import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import {
	MAX_ATTACHMENT_BYTES,
	MAX_TURN_ATTACHMENT_BYTES,
	type UploadedAttachment,
	UploadedAttachmentSchema,
} from "@prime-agent/web-protocol/fleet-contract";
import type { BridgeSession } from "./prime-bridge";

export { MAX_ATTACHMENT_BYTES, MAX_TURN_ATTACHMENT_BYTES };

export type ManagedAttachmentInspection = {
	metadata: UploadedAttachment;
	byteLength: number;
	dataPath: string;
};

export class ManagedAttachmentValidationError extends Error {
	readonly status: 400 | 413;

	constructor(message: string, status: 400 | 413) {
		super(message);
		this.name = "ManagedAttachmentValidationError";
		this.status = status;
	}
}

function attachmentRoot(session: BridgeSession) {
	return managedAttachmentRoot(session.sessionId, session.sessionPath);
}

function managedAttachmentRoot(sessionId: string, sessionPath: string) {
	return join(dirname(dirname(sessionPath)), "session-attachments", sessionId);
}

function contained(root: string, candidate: string) {
	const resolvedRoot = resolve(root);
	const resolvedCandidate = resolve(candidate);
	return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`);
}

function safeName(name: string) {
	const value = basename(name)
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.trim();
	return value.slice(0, 512) || "attachment";
}

function safeExtension(name: string) {
	const extension = extname(name).toLowerCase();
	return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : "";
}

export async function storeManagedAttachment(session: BridgeSession, file: File): Promise<UploadedAttachment> {
	if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("Attachment exceeds the 25 MiB limit");
	if (!file.type || !/^[\w.+-]+\/[\w.+-]+$/.test(file.type)) throw new Error("Attachment MIME type is invalid");

	const root = attachmentRoot(session);
	const attachmentId = crypto.randomUUID();
	const displayName = safeName(file.name);
	const dataPath = join(root, `${attachmentId}${safeExtension(displayName)}`);
	const metadataPath = join(root, `${attachmentId}.json`);
	if (!contained(root, dataPath) || !contained(root, metadataPath))
		throw new Error("Attachment path escaped managed storage");

	const metadata: UploadedAttachment = {
		kind: "upload",
		attachmentId,
		name: displayName,
		mimeType: file.type,
		size: file.size,
	};
	await mkdir(root, { recursive: true });
	await writeFile(dataPath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
	await writeFile(metadataPath, JSON.stringify({ ...metadata, dataFile: basename(dataPath) }), { flag: "wx" });
	return metadata;
}

export async function inspectManagedAttachment(
	session: BridgeSession,
	attachmentId: string,
): Promise<ManagedAttachmentInspection | undefined> {
	const root = attachmentRoot(session);
	const metadataPath = join(root, `${attachmentId}.json`);
	if (!contained(root, metadataPath)) return undefined;
	const raw = JSON.parse(await readFile(metadataPath, "utf8")) as UploadedAttachment & { dataFile?: string };
	const metadata = UploadedAttachmentSchema.safeParse(raw);
	if (!metadata.success) return undefined;
	if (!raw.dataFile || basename(raw.dataFile) !== raw.dataFile) return undefined;
	const dataPath = join(root, raw.dataFile);
	if (!contained(root, dataPath)) return undefined;
	const dataStat = await stat(dataPath);
	if (!dataStat.isFile()) return undefined;
	return { metadata: metadata.data, byteLength: dataStat.size, dataPath };
}

export async function validateManagedAttachments(
	session: BridgeSession,
	attachments: ReadonlyArray<Pick<UploadedAttachment, "attachmentId">>,
): Promise<Map<string, ManagedAttachmentInspection>> {
	const inspections = new Map<string, ManagedAttachmentInspection>();
	const attachmentIds = new Set<string>();
	for (const attachment of attachments) {
		if (attachmentIds.has(attachment.attachmentId)) {
			throw new ManagedAttachmentValidationError(`Duplicate attachment: ${attachment.attachmentId}`, 400);
		}
		attachmentIds.add(attachment.attachmentId);
	}
	const inspectedAttachments = await Promise.all(
		attachments.map((attachment) =>
			inspectManagedAttachment(session, attachment.attachmentId).catch(() => undefined),
		),
	);
	let totalBytes = 0;
	for (const [index, attachment] of attachments.entries()) {
		const inspected = inspectedAttachments[index];
		if (!inspected) {
			throw new ManagedAttachmentValidationError(`Unknown attachment: ${attachment.attachmentId}`, 400);
		}
		if (inspected.byteLength !== inspected.metadata.size) {
			throw new ManagedAttachmentValidationError(`Invalid attachment: ${attachment.attachmentId}`, 400);
		}
		if (inspected.byteLength > MAX_ATTACHMENT_BYTES) {
			throw new ManagedAttachmentValidationError("Attachment exceeds the 25 MiB limit", 413);
		}
		totalBytes += inspected.byteLength;
		if (totalBytes > MAX_TURN_ATTACHMENT_BYTES) {
			throw new ManagedAttachmentValidationError("Attachments exceed the 100 MiB per-turn limit", 413);
		}
		inspections.set(attachment.attachmentId, inspected);
	}
	return inspections;
}

export async function readInspectedManagedAttachment(inspected: ManagedAttachmentInspection) {
	if (!inspected || inspected.byteLength !== inspected.metadata.size) return undefined;
	const data = await readFile(inspected.dataPath);
	if (data.byteLength !== inspected.byteLength) return undefined;
	return { metadata: inspected.metadata, data };
}

export async function readManagedAttachment(session: BridgeSession, attachmentId: string) {
	const inspected = await inspectManagedAttachment(session, attachmentId);
	return inspected ? readInspectedManagedAttachment(inspected) : undefined;
}

export async function deleteManagedAttachments(session: BridgeSession) {
	await rm(attachmentRoot(session), { recursive: true, force: true });
}

export async function deleteManagedAttachmentsForSession(sessionId: string, sessionPath: string) {
	await rm(managedAttachmentRoot(sessionId, sessionPath), { recursive: true, force: true });
}
