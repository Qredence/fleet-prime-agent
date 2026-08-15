import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractZipSafe } from "../src/utils/zip-extract.js";

interface ZipEntrySpec {
	name: string;
	data?: Buffer;
	isSymlink?: boolean;
}

function crc(buf: Buffer): number {
	return crc32(buf) >>> 0;
}

function makeZip(entries: ZipEntrySpec[]): Buffer {
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = Buffer.from(entry.name, "utf8");
		const data = entry.data ?? Buffer.alloc(0);
		const isDir = entry.name.endsWith("/");
		const mode = isDir ? 0o40755 : entry.isSymlink ? 0o120777 : 0o100644;

		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(0x04034b50, 0);
		localHeader.writeUInt16LE(20, 4);
		localHeader.writeUInt32LE(crc(data), 14);
		localHeader.writeUInt32LE(data.length, 18);
		localHeader.writeUInt32LE(data.length, 22);
		localHeader.writeUInt16LE(name.length, 26);
		const local = Buffer.concat([localHeader, name, data]);
		localParts.push(local);

		const centralHeader = Buffer.alloc(46);
		centralHeader.writeUInt32LE(0x02014b50, 0);
		centralHeader.writeUInt16LE(20, 4);
		centralHeader.writeUInt16LE(20, 6);
		centralHeader.writeUInt32LE(crc(data), 16);
		centralHeader.writeUInt32LE(data.length, 20);
		centralHeader.writeUInt32LE(data.length, 24);
		centralHeader.writeUInt16LE(name.length, 28);
		centralHeader.writeUInt32LE((mode << 16) >>> 0, 38);
		centralHeader.writeUInt32LE(offset, 42);
		centralParts.push(Buffer.concat([centralHeader, name]));

		offset += local.length;
	}

	const central = Buffer.concat(centralParts);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(central.length, 12);
	eocd.writeUInt32LE(offset, 16);

	return Buffer.concat([...localParts, central, eocd]);
}

describe("extractZipSafe", () => {
	let workDir: string;
	let zipPath: string;
	let destDir: string;

	beforeEach(() => {
		workDir = mkdtempSync(join(tmpdir(), "zip-extract-"));
		zipPath = join(workDir, "archive.zip");
		destDir = join(workDir, "out");
	});

	afterEach(() => {
		rmSync(workDir, { recursive: true, force: true });
	});

	it("extracts regular files and directories", async () => {
		writeFileSync(
			zipPath,
			makeZip([
				{ name: "hello.txt", data: Buffer.from("hello") },
				{ name: "sub/" },
				{ name: "sub/nested.txt", data: Buffer.from("nested") },
			]),
		);

		await extractZipSafe(zipPath, destDir);

		expect(readFileSync(join(destDir, "hello.txt"), "utf8")).toBe("hello");
		expect(readFileSync(join(destDir, "sub", "nested.txt"), "utf8")).toBe("nested");
	});

	it("rejects symlink entries", async () => {
		writeFileSync(zipPath, makeZip([{ name: "link", data: Buffer.from("../../target"), isSymlink: true }]));

		await expect(extractZipSafe(zipPath, destDir)).rejects.toThrow(/symlink/);
	});

	it("rejects entries that escape the destination directory", async () => {
		writeFileSync(zipPath, makeZip([{ name: "../evil.txt", data: Buffer.from("evil") }]));

		await expect(extractZipSafe(zipPath, destDir)).rejects.toThrow(/escape|invalid relative path/);
	});

	it("rejects absolute and backslash entry names", async () => {
		writeFileSync(zipPath, makeZip([{ name: "/abs.txt", data: Buffer.from("x") }]));

		await expect(extractZipSafe(zipPath, destDir)).rejects.toThrow(/Unsafe zip entry name|absolute path/);

		writeFileSync(zipPath, makeZip([{ name: "..\\win.txt", data: Buffer.from("x") }]));

		await expect(extractZipSafe(zipPath, destDir)).rejects.toThrow(/Unsafe zip entry name|invalid relative path/);
	});
});
