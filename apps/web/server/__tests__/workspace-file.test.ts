import { mkdir, rm, writeFile, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	readWorkspaceFile,
	WORKSPACE_FILE_MAX_BYTES,
} from "../workspace-file"

describe("readWorkspaceFile", () => {
	let root: string

	beforeEach(async () => {
		root = join(
			tmpdir(),
			`prime-workspace-file-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		)
		await mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		// Best-effort cleanup; tmpdir GC is fine if this fails.
		try {
			await rm(root, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	it("reads a markdown file as ok text/markdown", async () => {
		await writeFile(join(root, "ARCHITECTURE.md"), "# Hello\n\nWorld\n", "utf8")
		const result = await readWorkspaceFile(root, "ARCHITECTURE.md")
		expect(result).toEqual({
			kind: "ok",
			body: {
				path: "ARCHITECTURE.md",
				name: "ARCHITECTURE.md",
				content: "# Hello\n\nWorld\n",
				mediaType: "text/markdown",
				size: expect.any(Number),
				status: "ok",
			},
		})
		if (result.kind === "ok") {
			expect(result.body.content).toContain("# Hello")
		}
	})

	it("returns 400 when path is missing", async () => {
		const result = await readWorkspaceFile(root, "  ")
		expect(result).toEqual({
			kind: "error",
			status: 400,
			message: "GET /api/workspace/file requires ?path=",
		})
	})

	it("returns 403 on path traversal", async () => {
		const result = await readWorkspaceFile(root, "../outside.txt")
		expect(result.kind).toBe("error")
		if (result.kind === "error") {
			expect(result.status).toBe(403)
		}
	})

	it("returns 404 for missing files", async () => {
		const result = await readWorkspaceFile(root, "missing.md")
		expect(result).toEqual({
			kind: "error",
			status: 404,
			message: "File not found: missing.md",
		})
	})

	it("returns too-large for files over the soft limit", async () => {
		const big = Buffer.alloc(WORKSPACE_FILE_MAX_BYTES + 1, 0x61)
		await writeFile(join(root, "big.txt"), big)
		const result = await readWorkspaceFile(root, "big.txt")
		expect(result).toEqual({
			kind: "ok",
			body: {
				path: "big.txt",
				name: "big.txt",
				content: "",
				mediaType: "application/octet-stream",
				size: WORKSPACE_FILE_MAX_BYTES + 1,
				status: "too-large",
			},
		})
	})

	it("returns unsupported for binary files with null bytes", async () => {
		await writeFile(join(root, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff]))
		const result = await readWorkspaceFile(root, "blob.bin")
		expect(result).toEqual({
			kind: "ok",
			body: {
				path: "blob.bin",
				name: "blob.bin",
				content: "",
				mediaType: "application/octet-stream",
				size: 4,
				status: "unsupported",
			},
		})
	})

	it("rejects symlink escape outside the workspace", async () => {
		const outside = join(
			tmpdir(),
			`prime-workspace-outside-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
		)
		await writeFile(outside, "secret\n", "utf8")
		await symlink(outside, join(root, "link.txt"))
		const result = await readWorkspaceFile(root, "link.txt")
		expect(result.kind).toBe("error")
		if (result.kind === "error") {
			expect(result.status).toBe(403)
		}
		await rm(outside, { force: true })
	})
})
