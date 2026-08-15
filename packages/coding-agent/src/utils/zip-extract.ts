import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Entry, ZipFile } from "yauzl";
import yauzl from "yauzl";

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

function isSymlinkEntry(entry: Entry): boolean {
	return ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK;
}

function isDirectoryEntry(entry: Entry): boolean {
	return ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFDIR;
}

function resolveEntryPath(fileName: string, destDir: string): string {
	if (fileName.includes("\0") || fileName.includes("\\") || fileName.startsWith("/")) {
		throw new Error(`Unsafe zip entry name: ${JSON.stringify(fileName)}`);
	}
	const dest = resolve(destDir);
	const target = resolve(dest, fileName);
	const rel = relative(dest, target);
	if (rel === "" || rel.startsWith("..") || rel.split("/").includes("..")) {
		throw new Error(`Zip entry escapes the extraction directory: ${JSON.stringify(fileName)}`);
	}
	return target;
}

function openZip(zipPath: string): Promise<ZipFile> {
	return new Promise((resolvePromise, rejectPromise) => {
		yauzl.open(zipPath, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (err, zipfile) => {
			if (err || !zipfile) {
				rejectPromise(err ?? new Error(`Failed to open zip archive: ${zipPath}`));
				return;
			}
			resolvePromise(zipfile);
		});
	});
}

function openEntryStream(zipfile: ZipFile, entry: Entry): Promise<Readable> {
	return new Promise((resolvePromise, rejectPromise) => {
		zipfile.openReadStream(entry, (err, stream) => {
			if (err || !stream) {
				rejectPromise(err ?? new Error(`Failed to read zip entry: ${entry.fileName}`));
				return;
			}
			resolvePromise(stream);
		});
	});
}

/**
 * Extract a zip archive into `destDir`.
 *
 * Unlike `extract-zip`, this rejects entries that would escape the target
 * directory or materialize symlinks, so malicious archives fail closed
 * instead of writing outside `destDir`.
 */
export async function extractZipSafe(zipPath: string, destDir: string): Promise<void> {
	const zipfile = await openZip(zipPath);

	await new Promise<void>((resolvePromise, rejectPromise) => {
		let settled = false;

		const fail = (err: unknown) => {
			if (settled) return;
			settled = true;
			zipfile.close();
			rejectPromise(err instanceof Error ? err : new Error(String(err)));
		};

		const handleEntry = async (entry: Entry) => {
			const target = resolveEntryPath(entry.fileName, destDir);

			if (isSymlinkEntry(entry)) {
				throw new Error(`Refusing to extract symlink zip entry: ${entry.fileName}`);
			}

			if (isDirectoryEntry(entry) || entry.fileName.endsWith("/")) {
				mkdirSync(target, { recursive: true, mode: 0o755 });
				return;
			}

			mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
			const stream = await openEntryStream(zipfile, entry);
			await pipeline(stream, createWriteStream(target, { mode: 0o644 }));
		};

		const next = () => {
			if (!settled) zipfile.readEntry();
		};

		zipfile.on("error", fail);
		zipfile.on("end", () => {
			if (settled) return;
			settled = true;
			resolvePromise();
		});
		zipfile.on("entry", (entry: Entry) => {
			handleEntry(entry).then(next, fail);
		});

		zipfile.readEntry();
	});
}
