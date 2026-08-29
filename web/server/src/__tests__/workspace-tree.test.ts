import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceTreeNode } from "@prime-agent/web-protocol/chat-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceTree } from "../workspace-tree";

const MAX_ENTRIES_PER_DIR = 100;
const MAX_DEPTH = 10;

function findNode(nodes: Array<WorkspaceTreeNode>, path: string): WorkspaceTreeNode | undefined {
	for (const node of nodes) {
		if (node.path === path) return node;
		const child = node.children ? findNode(node.children, path) : undefined;
		if (child) return child;
	}
	return undefined;
}

describe("readWorkspaceTree", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "prime-workspace-tree-"));
	});

	afterEach(async () => {
		try {
			await rm(root, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it("reports directories before files, alphabetical within each group", async () => {
		await mkdir(join(root, "zeta"), { recursive: true });
		await mkdir(join(root, "alpha"), { recursive: true });
		await writeFile(join(root, "beta.txt"), "x", "utf8");
		await writeFile(join(root, "gamma.txt"), "x", "utf8");

		const { nodes } = await readWorkspaceTree(root);

		const names = nodes.map((node) => node.name);
		expect(names).toEqual(["alpha", "zeta", "beta.txt", "gamma.txt"]);
	});

	it("filters .git, node_modules, and dist", async () => {
		for (const dir of [".git", "node_modules", "dist"]) {
			await mkdir(join(root, dir), { recursive: true });
		}
		await writeFile(join(root, "keep.txt"), "x", "utf8");

		const { nodes } = await readWorkspaceTree(root);
		const names = nodes.map((node) => node.name);
		expect(names).toEqual(["keep.txt"]);
	});

	it("filters dotfiles", async () => {
		await writeFile(join(root, ".env"), "x", "utf8");
		await writeFile(join(root, "plain.txt"), "x", "utf8");

		const { nodes } = await readWorkspaceTree(root);
		const names = nodes.map((node) => node.name);
		expect(names).toEqual(["plain.txt"]);
	});

	it("caps entries at MAX_ENTRIES_PER_DIR and emits a diagnostic", async () => {
		const total = MAX_ENTRIES_PER_DIR + 10;
		for (let i = 0; i < total; i++) {
			await writeFile(join(root, `file-${String(i).padStart(3, "0")}.txt`), "x", "utf8");
		}

		const { nodes, diagnostics } = await readWorkspaceTree(root);
		expect(nodes.length).toBe(MAX_ENTRIES_PER_DIR);
		expect(diagnostics).toContain(`Showing first ${MAX_ENTRIES_PER_DIR} of ${total} entries in .`);
	});

	it("includes nested folder files while retaining the depth bound", async () => {
		// The root call is depth 1, and child directories recurse while depth < MAX_DEPTH.
		await mkdir(join(root, "apps", "api", "app", "scripts"), { recursive: true });
		await writeFile(join(root, "apps", "api", "app", "scripts", "run.py"), "x", "utf8");
		const maxDepthPath = Array.from({ length: MAX_DEPTH }, (_, index) => `level-${index}`).join("/");
		await mkdir(join(root, maxDepthPath), { recursive: true });
		await writeFile(join(root, maxDepthPath, "too-deep.txt"), "x", "utf8");

		const { nodes } = await readWorkspaceTree(root);
		const apps = findNode(nodes, "apps");
		const api = findNode(apps?.children ?? [], "apps/api");
		const app = findNode(api?.children ?? [], "apps/api/app");
		const scripts = findNode(app?.children ?? [], "apps/api/app/scripts");
		expect(scripts?.type).toBe("directory");
		expect(scripts?.children?.some((child) => child.path === "apps/api/app/scripts/run.py")).toBe(true);

		const maxDepthNode = findNode(nodes, maxDepthPath);
		expect(maxDepthNode?.type).toBe("directory");
		expect(maxDepthNode?.children).toBeUndefined();
	});

	it("reports symlink-to-directory as directory and recurses into it", async () => {
		const target = join(root, "real-dir");
		await mkdir(target, { recursive: true });
		await writeFile(join(target, "inner.txt"), "x", "utf8");
		await symlink(target, join(root, "link-dir"));

		const { nodes } = await readWorkspaceTree(root);
		const link = findNode(nodes, "link-dir");
		expect(link?.type).toBe("directory");
		expect(link?.children?.some((child) => child.path === "link-dir/inner.txt")).toBe(true);
	});

	it("reports symlink-to-file as file", async () => {
		await writeFile(join(root, "real.txt"), "x", "utf8");
		await symlink(join(root, "real.txt"), join(root, "link.txt"));

		const { nodes } = await readWorkspaceTree(root);
		const link = findNode(nodes, "link.txt");
		expect(link?.type).toBe("file");
	});

	it("reports a dangling symlink as file", async () => {
		await symlink(join(root, "missing-target"), join(root, "dangling"));

		const { nodes } = await readWorkspaceTree(root);
		const link = findNode(nodes, "dangling");
		expect(link?.type).toBe("file");
	});

	it("does not recurse a directory symlink that escapes the workspace root", async () => {
		const outside = await mkdtemp(join(tmpdir(), "prime-workspace-outside-"));
		await writeFile(join(outside, "secret.txt"), "x", "utf8");
		await symlink(outside, join(root, "escape-dir"));

		try {
			const { nodes } = await readWorkspaceTree(root);
			const link = findNode(nodes, "escape-dir");
			expect(link?.type).toBe("directory");
			expect(link?.children).toBeUndefined();
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});
});
