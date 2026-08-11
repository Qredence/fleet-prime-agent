import { mkdir, symlink, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { browseWorkspaceDirectories } from "../workspace-browse"
import { resolveWorkspaceRootPath } from "../workspace-root"

describe("workspace-browse", () => {
	let root: string

	beforeEach(async () => {
		root = join(
			tmpdir(),
			`prime-workspace-browse-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		)
		await mkdir(join(root, "apps", "web"), { recursive: true })
		await mkdir(join(root, "packages"), { recursive: true })
		await writeFile(join(root, "README.md"), "hi\n", "utf8")
	})

	afterEach(async () => {
		try {
			await rm(root, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	it("lists child directories and excludes files and dotdirs", async () => {
		await mkdir(join(root, ".hidden"), { recursive: true })
		const result = await browseWorkspaceDirectories(root)
		expect(result.kind).toBe("ok")
		if (result.kind !== "ok") return
		expect(result.path).toBe(root)
		expect(result.entries.map((entry) => entry.name).sort()).toEqual([
			"apps",
			"packages",
		])
		expect(result.parent).toBeTruthy()
	})

	it("includes symlink-to-directory entries", async () => {
		const target = join(root, "packages")
		const link = join(root, "packages-link")
		await symlink(target, link)
		const result = await browseWorkspaceDirectories(root)
		expect(result.kind).toBe("ok")
		if (result.kind !== "ok") return
		expect(result.entries.map((entry) => entry.name).sort()).toEqual([
			"apps",
			"packages",
			"packages-link",
		])
	})

	it("rejects missing paths", async () => {
		const result = await browseWorkspaceDirectories(join(root, "missing"))
		expect(result).toMatchObject({ kind: "error", status: 404 })
	})

	it("rejects files for resolveWorkspaceRootPath", async () => {
		const result = await resolveWorkspaceRootPath(join(root, "README.md"))
		expect(result).toMatchObject({ kind: "error", status: 400 })
	})

	it("resolves a valid directory root", async () => {
		const result = await resolveWorkspaceRootPath(join(root, "apps"))
		expect(result).toEqual({
			kind: "ok",
			root: join(root, "apps"),
		})
	})
})
