import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "../project-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("ProjectRegistry", () => {
	it("serializes concurrent cold-start loads", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const registry = new ProjectRegistry(join(root, ".prime-agent"), root);

		const [projects, projectId] = await Promise.all([registry.list(), registry.projectIdForCwd(root)]);

		expect(projects).toHaveLength(1);
		expect(projectId).toBe(projects[0]?.projectId);
	});

	it("canonicalizes registrations, persists assignments, and reclaims unregistered projects", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const agentDirectory = join(root, ".prime-agent");
		const projectDirectory = join(root, "alpha");
		const symlinkDirectory = join(root, "alpha-link");
		await mkdir(projectDirectory);
		await symlink(projectDirectory, symlinkDirectory, "dir");

		const registry = new ProjectRegistry(agentDirectory, root);
		const first = await registry.register(projectDirectory);
		const duplicate = await registry.register(symlinkDirectory);
		expect(duplicate.projectId).toBe(first.projectId);

		await registry.assignSession("session-1", first.projectId);
		expect(await registry.projectIdForSession("session-1", projectDirectory)).toBe(first.projectId);

		const unregistered = await registry.unregister(first.projectId);
		expect(unregistered.status).toBe("unregistered");
		expect((await registry.list()).some((project) => project.projectId === first.projectId)).toBe(false);

		const reclaimed = await registry.register(symlinkDirectory, "Reclaimed Alpha");
		expect(reclaimed.projectId).toBe(first.projectId);
		expect(reclaimed.name).toBe("Reclaimed Alpha");
		expect(reclaimed.status).toBe("active");
	});

	it("issues opaque directory tokens and rejects invalid project paths", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const agentDirectory = join(root, ".prime-agent");
		const child = join(root, "child");
		await mkdir(child);

		const registry = new ProjectRegistry(agentDirectory, root);
		const listing = await registry.browse({ path: root });
		const childEntry = listing.entries.find((entry) => entry.name === "child");
		expect(listing.directoryToken).toMatch(/[A-Za-z0-9-]+/);
		expect(childEntry).toBeDefined();
		expect(childEntry?.directoryToken).toMatch(/[A-Za-z0-9-]+/);
		await expect(registry.resolveDirectoryInput({ directoryToken: childEntry!.directoryToken })).resolves.toBe(
			await realpath(child),
		);
		await expect(registry.register(join(root, "missing"))).rejects.toThrow();
		await expect(registry.register("relative/path")).rejects.toThrow("absolute");
	});

	it("filters directories without starvation from regular files and skips broken links", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const agentDirectory = join(root, ".prime-agent");

		// Create files with names sorting before "z-dir"
		for (let i = 0; i < 250; i++) {
			await writeFile(join(root, `file-${String(i).padStart(3, "0")}.txt`), "content");
		}
		// Create actual subdirectory and a broken symlink
		const validDir = join(root, "z-dir");
		const brokenLink = join(root, "broken-link");
		await mkdir(validDir);
		await symlink(join(root, "non-existent-target"), brokenLink, "dir");

		const registry = new ProjectRegistry(agentDirectory, root);
		const listing = await registry.browse({ path: root });
		expect(listing.entries.some((entry) => entry.name === "z-dir")).toBe(true);
		expect(listing.entries.some((entry) => entry.name === "broken-link")).toBe(false);
	});

	it("unassigns session on assignSession(sessionId, null)", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const registry = new ProjectRegistry(join(root, ".prime-agent"), root);
		const project = await registry.register(root);

		await registry.assignSession("session-1", project.projectId);
		expect(await registry.projectIdForSession("session-1", root)).toBe(project.projectId);

		await registry.assignSession("session-1", null);
		// After unassignment, looking up with a different cwd returns null
		const otherDir = join(root, "other");
		await mkdir(otherDir);
		expect(await registry.projectIdForSession("session-1", otherDir)).toBeNull();
	});
});
