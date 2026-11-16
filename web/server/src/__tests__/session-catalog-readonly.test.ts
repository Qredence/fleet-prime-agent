import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectRegistry } from "../project-registry";
import { handleChatSessionsGet } from "../handlers/chat-sessions";
import { handleProjectsGet } from "../handlers/projects";

const mocks = vi.hoisted(() => ({ registry: undefined as ProjectRegistry | undefined, listSessions: vi.fn() }));
vi.mock("../prime-config", () => ({ getPrimeConfig: () => ({ projectRegistry: mocks.registry }) }));
vi.mock("../singleton", () => ({
	getBridge: () => ({ listSessions: mocks.listSessions, getSession: () => undefined }),
}));
let root: string;
let agentDir: string;
const write = vi.fn(writeFile);

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "fleet-readonly-catalog-"));
	agentDir = join(root, "agent");
	write.mockClear();
	mocks.registry = new ProjectRegistry(agentDir, root, {
		mkdir,
		rename,
		unlink,
		writeFile: (path, data, encoding) => write(path, data, encoding),
	});
	mocks.listSessions.mockResolvedValue([
		{
			id: "legacy-session",
			cwd: root,
			name: "api_key=synthetic-secret",
			firstMessage: "password=synthetic-secret",
			messageCount: 1,
			created: "2026-01-01T00:00:00Z",
			modified: "2026-01-01T00:00:01Z",
		},
	]);
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it("does not create a registry or agent directory on cold catalog reads", async () => {
	const sessions = await handleChatSessionsGet(new Request("http://localhost/api/chat/sessions"));
	const projects = await handleProjectsGet(new Request("http://localhost/api/projects"));
	expect(sessions.status).toBe(200);
	expect(projects.status).toBe(200);
	expect(write).not.toHaveBeenCalled();
	await expect(stat(agentDir)).rejects.toMatchObject({ code: "ENOENT" });
});

it("shares redacted summaries and project counts without persisting inferred assignments", async () => {
	const registry = mocks.registry!;
	const project = await registry.register(root);
	const before = await readFile(join(agentDir, "fleet-projects.json"), "utf8");
	write.mockClear();
	const assigningLookup = vi.spyOn(registry, "projectIdForSession");
	const sessions = await (
		await handleChatSessionsGet(new Request(`http://localhost/api/chat/sessions?projectId=${project.projectId}`))
	).json();
	const projects = await (await handleProjectsGet(new Request("http://localhost/api/projects"))).json();
	expect(sessions.sessions).toEqual(projects.sessions);
	expect(projects.projects[0].sessionCount).toBe(1);
	expect(sessions.sessions[0].projectId).toBe(project.projectId);
	expect(JSON.stringify(sessions)).not.toContain("synthetic-secret");
	expect(JSON.stringify(sessions)).toContain("[redacted]");
	expect(write).not.toHaveBeenCalled();
	expect(assigningLookup).not.toHaveBeenCalled();
	expect(await readFile(join(agentDir, "fleet-projects.json"), "utf8")).toBe(before);
});
