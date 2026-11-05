import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	withTransientDaemonSession: vi.fn(),
}));

vi.mock("../daemon-runtime", () => ({
	withTransientDaemonSession: mocks.withTransientDaemonSession,
}));

import { removeMcpConnection, storeMcpStaticToken } from "../mcp-daemon-credentials";

describe("MCP daemon credentials", () => {
	beforeEach(() => {
		mocks.withTransientDaemonSession.mockReset();
	});

	it("stores a token through a transient session and reports verification", async () => {
		const setMcpStaticToken = vi.fn(async () => ({
			server: "linear",
			endpoint: "https://mcp.linear.app",
			verified: true,
			toolCount: 12,
			error: null,
		}));
		mocks.withTransientDaemonSession.mockImplementation(async (_cwd, work) => work({ setMcpStaticToken }, "s1"));

		const outcome = await storeMcpStaticToken("/workspace", "linear", "  tok  ");
		expect(outcome).toEqual({ status: "stored", verified: true, toolCount: 12 });
		// The token is trimmed before it reaches the daemon.
		expect(setMcpStaticToken).toHaveBeenCalledWith("s1", "linear", "tok");
	});

	it("reports a failed verification as stored, not as a failed write", async () => {
		// The daemon stores the credential even when verification fails, so
		// surfacing this as an error would make the UI retry a write that landed.
		const setMcpStaticToken = vi.fn(async () => ({
			server: "notion",
			endpoint: "https://mcp.notion.com",
			verified: false,
			toolCount: null,
			error: "unauthorized",
		}));
		mocks.withTransientDaemonSession.mockImplementation(async (_cwd, work) => work({ setMcpStaticToken }, "s1"));

		const outcome = await storeMcpStaticToken("/workspace", "notion", "tok");
		expect(outcome).toEqual({ status: "stored", verified: false, toolCount: null, error: "unauthorized" });
	});

	it("refuses an empty token without contacting the daemon", async () => {
		const outcome = await storeMcpStaticToken("/workspace", "linear", "   ");
		expect(outcome.status).toBe("refused");
		expect(mocks.withTransientDaemonSession).not.toHaveBeenCalled();
	});

	it("turns a daemon refusal into a refusal, not a crash", async () => {
		mocks.withTransientDaemonSession.mockRejectedValue(new Error("Unknown MCP server: nope"));
		const outcome = await storeMcpStaticToken("/workspace", "nope", "tok");
		expect(outcome).toEqual({ status: "refused", reason: "Unknown MCP server: nope" });
	});

	it("removes a connection and reports whether it existed", async () => {
		const removeMcpConnectionFn = vi.fn(async () => ({ server: "linear", removed: true }));
		mocks.withTransientDaemonSession.mockImplementation(async (_cwd, work) =>
			work({ removeMcpConnection: removeMcpConnectionFn }, "s1"),
		);

		expect(await removeMcpConnection("/workspace", "linear")).toEqual({ status: "removed", removed: true });
		expect(removeMcpConnectionFn).toHaveBeenCalledWith("s1", "linear");
	});

	it("surfaces a removal failure as a refusal", async () => {
		mocks.withTransientDaemonSession.mockRejectedValue(new Error("daemon gone"));
		expect(await removeMcpConnection("/workspace", "linear")).toEqual({ status: "refused", reason: "daemon gone" });
	});

	it("disposes the transient session even when the write throws", async () => {
		// The helper owns disposal; this asserts the contract the module relies on:
		// a rejected work call must still propagate as a refusal rather than
		// leaving the caller without an answer.
		let disposed = false;
		mocks.withTransientDaemonSession.mockImplementation(async (_cwd, work) => {
			try {
				return await work(
					{
						setMcpStaticToken: async () => {
							throw new Error("verify exploded");
						},
					},
					"s1",
				);
			} finally {
				disposed = true;
			}
		});

		const outcome = await storeMcpStaticToken("/workspace", "linear", "tok");
		expect(outcome.status).toBe("refused");
		expect(disposed).toBe(true);
	});
});
