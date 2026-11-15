import { beforeEach, expect, it, vi } from "vitest";
import { ChatResourcesResponseSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { DaemonResourceSnapshot } from "../daemon-protocol";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), loader: vi.fn() }));
vi.mock("../project-request", () => ({ cwdForRequest: async () => "/workspace" }));
vi.mock("../singleton", () => ({ getBridge: () => ({ getResourceSnapshot: mocks.snapshot }) }));
vi.mock("../prime-config", () => ({
	getPrimeConfig: () => ({
		settingsFor: () => ({ getPackages: () => [] }),
		resourceLoaderFor: mocks.loader,
	}),
}));
import { handleChatResourcesGet } from "../handlers/chat-resources";

beforeEach(() => {
	mocks.snapshot.mockReset();
	mocks.loader.mockResolvedValue({
		getSkills: () => ({
			skills: [
				{
					name: "discovered",
					description: "From discovery",
					filePath: "/user/skill.md",
					sourceInfo: { scope: "user", origin: "top-level", source: "auto" },
				},
			],
			diagnostics: [],
		}),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getExtensions: () => ({ extensions: [], errors: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
	});
});

it("keeps cold discovery separate from loaded session resources", async () => {
	mocks.snapshot.mockResolvedValue({
		skills: [],
		prompts: [],
		contextFiles: [],
		themes: [],
		diagnostics: { skills: [], prompts: [], themes: [] },
	} satisfies DaemonResourceSnapshot);
	const response = await handleChatResourcesGet(new Request("http://localhost/api/chat/resources?sessionId=cold"));
	const body = ChatResourcesResponseSchema.parse(await response.json());
	expect(mocks.snapshot).toHaveBeenCalledWith("cold", "/workspace");
	expect(body.snapshotState).toBe("empty");
	expect(body.skills[0]).toMatchObject({ scope: "user", origin: "top-level", discoverySource: "legacy-discovery" });
	expect(body.skills[0]?.loadedInSession).toBeUndefined();
	expect(body.skills[0]?.installedInWorkspace).toBeUndefined();
});

it("prefers daemon provenance for loaded skills and retains discovery-only entries", async () => {
	mocks.snapshot.mockResolvedValue({
		skills: [
			{
				name: "loaded",
				filePath: "/project/skill.md",
				description: "From daemon",
				sourceInfo: {
					scope: "project",
					origin: "topLevel",
					source: "auto",
					path: "/project/skill.md",
					baseDir: "/project",
				},
			},
		],
		prompts: [],
		contextFiles: [],
		themes: [],
		diagnostics: {
			skills: [{ type: "warning", message: "Check skill", path: "/project/skill.md" }],
			prompts: [],
			themes: [],
		},
	} satisfies DaemonResourceSnapshot);
	const body = ChatResourcesResponseSchema.parse(
		await (await handleChatResourcesGet(new Request("http://localhost/api/chat/resources?sessionId=warm"))).json(),
	);
	expect(body.snapshotState).toBe("available");
	expect(body.skills).toHaveLength(2);
	expect(body.skills[1]).toMatchObject({
		scope: "project",
		origin: "top-level",
		discoverySource: "daemon",
		loadedInSession: true,
	});
	expect(body.diagnostics).toContain("warning: Check skill (/project/skill.md)");
});

it("does not request a daemon snapshot without a session and preserves discovery on failure", async () => {
	const request = new Request("http://localhost/api/chat/resources");
	expect((await (await handleChatResourcesGet(request)).json()).snapshotState).toBe("unavailable");
	expect(mocks.snapshot).not.toHaveBeenCalled();
	mocks.snapshot.mockRejectedValue(new Error("Unavailable"));
	const response = await handleChatResourcesGet(new Request("http://localhost/api/chat/resources?sessionId=failed"));
	expect(response.status).toBe(200);
	const body = ChatResourcesResponseSchema.parse(await response.json());
	expect(body.snapshotState).toBe("unavailable");
	expect(body.skills).toHaveLength(1);
	expect(body.diagnostics).toContain("The session resource snapshot could not be read; showing discovery results.");
});
