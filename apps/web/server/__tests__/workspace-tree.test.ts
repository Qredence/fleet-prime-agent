import { mkdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readWorkspaceTree } from "../workspace-tree"
import type { WorkspaceTreeNode } from "@prime-agent/web-protocol/chat-protocol"

const MAX_ENTRIES_PER_DIR = 100

function findNode(
	nodes: Array<WorkspaceTreeNode>,
	path: string,
): WorkspaceTreeNode | undefined {
	return nodes.find((node) => node.path === path)
}

describe("readWorkspaceTree", () => {
	let root: string

	beforeEach(async () => {
		root = join(
			tmpdir(),
			`prime-workspace-tree-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		)
		await mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		try {
			const { rm } = await import("node:fs/promises")
			await rm(root, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	it("reports directories before files, alphabetical within each group", async () => {
		await mkdir(join(root, "zeta"), { recursive: true })
		await mkdir(join(root, "alpha"), { recursive: true })
		await writeFile(join(root, "beta.txt"), "x", "utf8")
		await writeFile(join(root, "gamma.txt"), "x", "utf8")

		const { nodes } = await readWorkspaceTree(root)

		const names = nodes.map((node) => node.name)
		expect(names).toEqual(["alpha", "zeta", "beta.txt", "gamma.txt"])
	})

	it("filters .git, node_modules, and dist", async () => {
		for (const dir of [".git", "node_modules", "dist"]) {
			await mkdir(join(root, dir), { recursive: true })
		}
		await writeFile(join(root, "keep.txt"), "x", "utf8")

		const { nodes } = await readWorkspaceTree(root)
		const names = nodes.map((node) => node.name)
		expect(names).toEqual(["keep.txt"])
	})

	it("filters dotfiles", async () => {
		await writeFile(join(root, ".env"), "x", "utf8")
		await writeFile(join(root, "plain.txt"), "x", "utf8")

		const { nodes } = await readWorkspaceTree(root)
		const names = nodes.map((node) => node.name)
		expect(names).toEqual(["plain.txt"])
	})

	it("caps entries at MAX_ENTRIES_PER_DIR and emits a diagnostic", async () => {
		const total = MAX_ENTRIES_PER_DIR + 10
		for (let i = 0; i < total; i++) {
			await writeFile(join(root, `file-${String(i).padStart(3, "0")}.txt`), "x", "utf8")
		}

		const { nodes, diagnostics } = await readWorkspaceTree(root)
		expect(nodes.length).toBe(MAX_ENTRIES_PER_DIR)
		expect(diagnostics).toContain(
			`Showing first ${MAX_ENTRIES_PER_DIR} of ${total} entries in .`,
		)
	})

	it("recurses children at depth 1 but stops beyond MAX_DEPTH", async () => {
		// MAX_DEPTH = 3; root call is depth 1, children recurse while depth < 3.
		await mkdir(join(root, "a", "b", "c"), { recursive: true })
		await writeFile(join(root, "a", "b", "c", "deep.txt"), "x", "utf8")

		const { nodes } = await readWorkspaceTree(root)
		const a = findNode(nodes, "a")
		expect(a?.type).toBe("directory")
		expect(a?.children?.some((child) => child.path === "a/b")).toBe(true)

		const b = findNode(a?.children ?? [], "a/b")
		expect(b?.type).toBe("directory")
		expect(b?.children?.some((child) => child.path === "a/b/c")).toBe(true)

		const c = findNode(b?.children ?? [], "a/b/c")
		expect(c?.type).toBe("directory")
		expect(c?.children).toBeUndefined()
	})

	it("reports symlink-to-directory as directory and recurses into it", async () => {
		const target = join(root, "real-dir")
		await mkdir(target, { recursive: true })
		await writeFile(join(target, "inner.txt"), "x", "utf8")
		await symlink(target, join(root, "link-dir"))

		const { nodes } = await readWorkspaceTree(root)
		const link = findNode(nodes, "link-dir")
		expect(link?.type).toBe("directory")
		expect(link?.children?.some((child) => child.path === "link-dir/inner.txt")).toBe(true)
	})

	it("reports symlink-to-file as file", async () => {
		await writeFile(join(root, "real.txt"), "x", "utf8")
		await symlink(join(root, "real.txt"), join(root, "link.txt"))

		const { nodes } = await readWorkspaceTree(root)
		const link = findNode(nodes, "link.txt")
		expect(link?.type).toBe("file")
	})

	it("reports a dangling symlink as file", async () => {
		await symlink(join(root, "missing-target"), join(root, "dangling"))

		const { nodes } = await readWorkspaceTree(root)
		const link = findNode(nodes, "dangling")
		expect(link?.type).toBe("file")
	})
})
