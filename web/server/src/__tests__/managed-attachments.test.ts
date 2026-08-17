import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deleteManagedAttachments,
	inspectManagedAttachment,
	MAX_ATTACHMENT_BYTES,
	readManagedAttachment,
	storeManagedAttachment,
	validateManagedAttachments,
} from "../managed-attachments";
import type { BridgeSession } from "../prime-bridge";

describe("managed attachments", () => {
	let root: string;
	let session: BridgeSession;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "prime-managed-attachments-"));
		const sessionsRoot = join(root, "sessions");
		await mkdir(sessionsRoot);
		session = {
			sessionId: "session-1",
			sessionPath: join(sessionsRoot, "session-1.jsonl"),
		} as unknown as BridgeSession;
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("stores generated files without retaining the original external path", async () => {
		const attachment = await storeManagedAttachment(
			session,
			new File(["hello"], "../unsafe/report.txt", { type: "text/plain" }),
		);

		expect(attachment.name).toBe("report.txt");
		expect(attachment.attachmentId).toMatch(/^[0-9a-f-]{36}$/i);
		const stored = await readManagedAttachment(session, attachment.attachmentId);
		expect(stored?.data.toString("utf8")).toBe("hello");
		expect(JSON.stringify(stored)).not.toContain("unsafe");
	});

	it("rejects invalid MIME types and oversized files", async () => {
		await expect(storeManagedAttachment(session, new File(["hello"], "file.txt"))).rejects.toThrow(
			"MIME type is invalid",
		);
		const oversized = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "large.bin", {
			type: "application/octet-stream",
		});
		await expect(storeManagedAttachment(session, oversized)).rejects.toThrow("25 MiB limit");
	});

	it("deletes all managed files with the session", async () => {
		const attachment = await storeManagedAttachment(
			session,
			new File(["hello"], "report.txt", { type: "text/plain" }),
		);
		await deleteManagedAttachments(session);
		await expect(readManagedAttachment(session, attachment.attachmentId)).rejects.toThrow();
	});

	it("inspects stored bytes before loading attachment data", async () => {
		const attachment = await storeManagedAttachment(
			session,
			new File(["hello"], "report.txt", { type: "text/plain" }),
		);

		await expect(inspectManagedAttachment(session, attachment.attachmentId)).resolves.toMatchObject({
			metadata: attachment,
			byteLength: 5,
		});
	});

	it("rejects managed files whose stored metadata does not match their bytes", async () => {
		const attachment = await storeManagedAttachment(
			session,
			new File(["hello"], "report.txt", { type: "text/plain" }),
		);
		const metadataPath = join(root, "session-attachments", session.sessionId, `${attachment.attachmentId}.json`);
		const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { dataFile: string };
		await writeFile(metadataPath, JSON.stringify({ ...attachment, size: 99, dataFile: metadata.dataFile }));

		await expect(readManagedAttachment(session, attachment.attachmentId)).resolves.toBeUndefined();
	});

	it("rejects duplicate managed attachment IDs", async () => {
		const attachment = await storeManagedAttachment(
			session,
			new File(["hello"], "report.txt", { type: "text/plain" }),
		);

		await expect(validateManagedAttachments(session, [attachment, attachment])).rejects.toThrow(
			`Duplicate attachment: ${attachment.attachmentId}`,
		);
	});

	it("enforces the aggregate limit from stored byte sizes", async () => {
		const attachments = await Promise.all(
			Array.from({ length: 5 }, (_, index) =>
				storeManagedAttachment(
					session,
					new File([new Uint8Array(25 * 1024 * 1024)], `file-${index}.bin`, {
						type: "application/octet-stream",
					}),
				),
			),
		);

		await expect(validateManagedAttachments(session, attachments)).rejects.toThrow(
			"Attachments exceed the 100 MiB per-turn limit",
		);
	});
});
