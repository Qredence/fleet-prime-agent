import { mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveDefaultWorkspaceRoot } from "../workspace-root"

describe("resolveDefaultWorkspaceRoot", () => {
	let root: string

	beforeEach(async () => {
		root = join(
			tmpdir(),
			`prime-workspace-root-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		)
		await mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		try {
			await rm(root, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	it("walks up from a nested package cwd to the git repo root", async () => {
		const repo = join(root, "prime-agent")
		const packageCwd = join(repo, "apps", "web")
		await mkdir(join(repo, ".git"), { recursive: true })
		await mkdir(packageCwd, { recursive: true })

		expect(resolveDefaultWorkspaceRoot(packageCwd)).toBe(repo)
	})

	it("returns startDir when no .git ancestor exists", async () => {
		const orphan = join(root, "orphan", "apps", "web")
		await mkdir(orphan, { recursive: true })

		expect(resolveDefaultWorkspaceRoot(orphan)).toBe(orphan)
	})

	it("honors PRIME_AGENT_WORKSPACE_ROOT over git discovery", async () => {
		const repo = join(root, "prime-agent")
		const packageCwd = join(repo, "apps", "web")
		const override = join(root, "custom-workspace")
		await mkdir(join(repo, ".git"), { recursive: true })
		await mkdir(packageCwd, { recursive: true })
		await mkdir(override, { recursive: true })

		expect(
			resolveDefaultWorkspaceRoot(packageCwd, {
				PRIME_AGENT_WORKSPACE_ROOT: override,
			}),
		).toBe(override)
	})

	it("treats a .git file (worktree) as the repo root marker", async () => {
		const repo = join(root, "worktree")
		const nested = join(repo, "apps", "web")
		await mkdir(nested, { recursive: true })
		await writeFile(join(repo, ".git"), "gitdir: /tmp/fake.git\n", "utf8")

		expect(resolveDefaultWorkspaceRoot(nested)).toBe(repo)
	})
})
