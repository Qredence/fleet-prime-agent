import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeSession, PrimeBridge } from "../prime-bridge";
import { requireSession } from "../handlers/session-access";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn<PrimeBridge["getSession"]>(),
	resumeSessionById: vi.fn<PrimeBridge["resumeSessionById"]>(),
	getProject: vi.fn(),
}));
vi.mock("../singleton", () => ({ getBridge: () => mocks }));
vi.mock("../prime-config", () => ({
	getPrimeConfig: () => ({ projectRegistry: { get: mocks.getProject } }),
}));

const session = { sessionId: "session-1", projectId: "project-1" } as BridgeSession;

beforeEach(() => {
	vi.resetAllMocks();
	mocks.getSession.mockReturnValue(session);
	mocks.getProject.mockResolvedValue({ projectId: session.projectId });
});

describe("requireSession", () => {
	it("authorizes cached sessions without reattaching", async () => {
		await expect(requireSession(session.sessionId)).resolves.toBe(session);
		expect(mocks.getProject).toHaveBeenCalledWith(session.projectId);
		expect(mocks.resumeSessionById).not.toHaveBeenCalled();
	});

	it("rechecks membership after a live session's project is unregistered", async () => {
		await expect(requireSession(session.sessionId)).resolves.toBe(session);
		mocks.getProject.mockRejectedValue(new Error("Unknown project"));
		await expect(requireSession(session.sessionId)).resolves.toBeUndefined();
		expect(mocks.getProject).toHaveBeenCalledTimes(2);
		expect(mocks.resumeSessionById).not.toHaveBeenCalled();
	});

	it("rejects unassigned cached sessions rather than resuming or claiming them", async () => {
		mocks.getSession.mockReturnValue({ ...session, projectId: null });
		await expect(requireSession(session.sessionId)).resolves.toBeUndefined();
		expect(mocks.getProject).not.toHaveBeenCalled();
		expect(mocks.resumeSessionById).not.toHaveBeenCalled();
	});

	it("rejects a cached session in a different requested project", async () => {
		await expect(requireSession(session.sessionId, { projectId: "another-project" })).resolves.toBeUndefined();
		expect(mocks.resumeSessionById).not.toHaveBeenCalled();
	});

	it("passes project and OpenUI options through the checked cold-resume path", async () => {
		mocks.getSession.mockReturnValue(undefined);
		mocks.resumeSessionById.mockResolvedValue(session);
		await expect(requireSession(session.sessionId, { projectId: session.projectId, openUI: true })).resolves.toBe(
			session,
		);
		expect(mocks.resumeSessionById).toHaveBeenCalledWith(session.sessionId, session.projectId, { openUI: true });
		expect(mocks.getProject).toHaveBeenCalledWith(session.projectId);
	});

	it("does not trust resumed sessions after project membership has changed", async () => {
		mocks.getSession.mockReturnValue(undefined);
		mocks.resumeSessionById.mockResolvedValue(session);
		mocks.getProject.mockRejectedValue(new Error("Unknown project"));
		await expect(requireSession(session.sessionId)).resolves.toBeUndefined();
	});

	it("returns unknown without checking a project when cold resume finds nothing", async () => {
		mocks.getSession.mockReturnValue(undefined);
		await expect(requireSession("missing")).resolves.toBeUndefined();
		expect(mocks.getProject).not.toHaveBeenCalled();
	});

	it("keeps read-only discovery and child hydration from resuming cold sessions", async () => {
		mocks.getSession.mockReturnValue(undefined);
		await expect(requireSession(session.sessionId, { resume: false })).resolves.toBeUndefined();
		expect(mocks.resumeSessionById).not.toHaveBeenCalled();
	});

	it("rejects malformed identifiers before looking up any runtime state", async () => {
		await expect(requireSession("../private")).resolves.toBeUndefined();
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.resumeSessionById).not.toHaveBeenCalled();
	});
});
