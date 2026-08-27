import { mkdir, mkdtemp, realpath, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRegistry } from "../project-registry";
import { safeErrorMessage, wrapApiHandler } from "../wrap-api-handler";

const temporaryDirectories: string[] = [];

function createPersistenceHarness() {
	const writePaths: string[] = [];
	let nextWriteError: Error | undefined;
	let nextRenameError: Error | undefined;

	return {
		writePaths,
		failNextWrite(error: Error) {
			nextWriteError = error;
		},
		failNextRename(error: Error) {
			nextRenameError = error;
		},
		persistence: {
			mkdir: (path: string, options: { recursive: true }) => mkdir(path, options),
			writeFile: async (path: string, data: string, encoding: "utf8") => {
				writePaths.push(path);
				if (nextWriteError) {
					const error = nextWriteError;
					nextWriteError = undefined;
					throw error;
				}
				await writeFile(path, data, encoding);
			},
			rename: async (oldPath: string, newPath: string) => {
				if (nextRenameError) {
					const error = nextRenameError;
					nextRenameError = undefined;
					throw error;
				}
				await rename(oldPath, newPath);
			},
			unlink: (path: string) => unlink(path),
		},
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

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

	it("does not rewrite an unchanged session assignment", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const harness = createPersistenceHarness();
		const registry = new ProjectRegistry(join(root, ".prime-agent"), root, harness.persistence);
		const project = (await registry.list())[0]!;
		const writesBeforeAssignment = harness.writePaths.length;

		await registry.assignSession("session-1", project.projectId);
		await registry.assignSession("session-1", project.projectId);

		expect(harness.writePaths).toHaveLength(writesBeforeAssignment + 1);
	});

	it("reports a safe assignment error, cleans the temporary file, and retries later", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const harness = createPersistenceHarness();
		const registry = new ProjectRegistry(join(root, ".prime-agent"), root, harness.persistence);
		const project = (await registry.list())[0]!;
		const failure = new Error(`EPERM: operation not permitted, open '${join(root, "fleet-projects.json.123.tmp")}'`);
		harness.failNextWrite(failure);

		const response = await wrapApiHandler(async () => {
			await registry.assignSession("session-1", project.projectId);
			return Response.json({ ok: true });
		});
		const failedTemporaryPath = harness.writePaths.at(-1)!;

		expect(response.status).toBe(500);
		const body = (await response.json()) as { message: string };
		expect(body.message).toBe("Could not save the session's project assignment. Please try again.");
		expect(body.message).not.toContain(root);
		expect(await pathExists(failedTemporaryPath)).toBe(false);

		await expect(registry.assignSession("session-1", project.projectId)).resolves.toBeUndefined();
		expect(await registry.projectIdForSession("session-1", root)).toBe(project.projectId);
	});

	it("retries an inferred assignment after a failed persistence", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const harness = createPersistenceHarness();
		const registry = new ProjectRegistry(join(root, ".prime-agent"), root, harness.persistence);
		const project = (await registry.list())[0]!;
		const writesBeforeAssignment = harness.writePaths.length;
		harness.failNextWrite(new Error("write failed"));

		await expect(registry.projectIdForSession("session-1", root)).rejects.toThrow(
			"Could not save the session's project assignment. Please try again.",
		);
		await expect(registry.projectIdForSession("session-1", root)).resolves.toBe(project.projectId);
		expect(harness.writePaths).toHaveLength(writesBeforeAssignment + 2);
	});

	it("uses unique temporary paths and removes a temporary file when rename fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-project-registry-"));
		temporaryDirectories.push(root);
		const harness = createPersistenceHarness();
		const registry = new ProjectRegistry(join(root, ".prime-agent"), root, harness.persistence);
		const project = (await registry.list())[0]!;
		const writesBeforeAssignments = harness.writePaths.length;
		const renameFailure = new Error("rename failed");
		harness.failNextRename(renameFailure);

		const response = await wrapApiHandler(async () => {
			await registry.assignSession("session-1", project.projectId);
			return Response.json({ ok: true });
		});
		const failedTemporaryPath = harness.writePaths.at(-1)!;
		await expect(registry.assignSession("session-1", project.projectId)).resolves.toBeUndefined();

		expect(response.status).toBe(500);
		const body = (await response.json()) as { message: string };
		expect(body.message).toBe("Could not save the session's project assignment. Please try again.");
		expect(await pathExists(failedTemporaryPath)).toBe(false);
		const assignmentTemporaryPaths = harness.writePaths.slice(writesBeforeAssignments);
		expect(assignmentTemporaryPaths).toHaveLength(2);
		expect(new Set(assignmentTemporaryPaths).size).toBe(2);
	});

	it("redacts quoted filesystem paths that contain spaces", () => {
		const message = safeErrorMessage(new Error("open '/Users/zocho/Prime Agent/fleet-projects.json.tmp'"));

		expect(message).toBe("open '[local path]'");
		expect(message).not.toContain("/Users/zocho");
	});
});
