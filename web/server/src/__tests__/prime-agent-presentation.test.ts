import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	deleteManagedPlanPresentationsForSession,
	loadManagedPlanPresentations,
	upsertManagedPlanPresentation,
} from "../managed-plan-presentations";
import {
	createEmptyPrimeAgentSessionPresentation,
	deleteManagedPrimePresentationForSession,
	loadManagedPrimePresentation,
	MAX_KERNEL_STDERR_TAIL_BYTES,
	readKernelStderrTail,
	writeManagedPrimePresentation,
} from "../prime-agent-presentation";
import type { BridgeSession } from "../prime-bridge";

function sessionLayout() {
	const workDir = mkdtempSync(join(tmpdir(), "prime-presentation-test-"));
	const sessionPath = join(workDir, "sessions", "abc123.jsonl");
	mkdirSync(join(workDir, "session-artifacts", "abc123"), { recursive: true });
	return { workDir, sessionPath };
}

describe("readKernelStderrTail", () => {
	it("returns undefined when the kernel never started", async () => {
		const { workDir, sessionPath } = sessionLayout();
		try {
			await expect(readKernelStderrTail({ sessionPath })).resolves.toBeUndefined();
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("returns the full tail for small logs", async () => {
		const { workDir, sessionPath } = sessionLayout();
		try {
			writeFileSync(join(workDir, "session-artifacts", "abc123", "kernel-stderr.log"), "boom\n", "utf8");
			await expect(readKernelStderrTail({ sessionPath })).resolves.toEqual({
				truncated: false,
				tail: "boom\n",
			});
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("truncates logs above the cap to the trailing bytes", async () => {
		const { workDir, sessionPath } = sessionLayout();
		try {
			writeFileSync(
				join(workDir, "session-artifacts", "abc123", "kernel-stderr.log"),
				`${"x".repeat(100)}TAIL`,
				"utf8",
			);
			const result = await readKernelStderrTail({ sessionPath }, 8);
			expect(result).toEqual({ truncated: true, tail: "xxxxTAIL" });
			expect(Buffer.byteLength(result!.tail, "utf8")).toBeLessThanOrEqual(8);
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("caps at the default budget", () => {
		expect(MAX_KERNEL_STDERR_TAIL_BYTES).toBe(65_536);
	});
});

describe("deleteManagedPrimePresentationForSession", () => {
	it("removes the session-artifacts directory for a deleted session", async () => {
		const { workDir, sessionPath } = sessionLayout();
		try {
			await writeManagedPrimePresentation(
				{ sessionPath },
				createEmptyPrimeAgentSessionPresentation({ sessionName: "To Delete" }),
			);
			expect(await loadManagedPrimePresentation({ sessionPath })).toMatchObject({ sessionName: "To Delete" });

			await deleteManagedPrimePresentationForSession(sessionPath);

			expect(existsSync(join(workDir, "session-artifacts", "abc123"))).toBe(false);
			expect(await loadManagedPrimePresentation({ sessionPath })).toBeUndefined();
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});
});

describe("upsertManagedPlanPresentation concurrency", () => {
	it("serializes concurrent upserts for the same session without dropping records", async () => {
		const { workDir, sessionPath } = sessionLayout();
		const session = { sessionId: "session-plan-1", sessionPath } as BridgeSession;
		try {
			await Promise.all([
				upsertManagedPlanPresentation(session, {
					assistantMessageId: "session-plan-1-m1",
					state: {
						mode: "plan",
						executing: false,
						pendingDecision: true,
						completed: 0,
						total: 1,
						todos: [{ step: 1, text: "Step 1", completed: false }],
					},
				}),
				upsertManagedPlanPresentation(session, {
					assistantMessageId: "session-plan-1-m3",
					state: {
						mode: "plan",
						executing: false,
						pendingDecision: false,
						completed: 1,
						total: 1,
						todos: [{ step: 1, text: "Step 2", completed: true }],
					},
				}),
			]);

			const loaded = await loadManagedPlanPresentations(session);
			expect(loaded.map((item) => item.assistantMessageId)).toEqual(["session-plan-1-m1", "session-plan-1-m3"]);

			await deleteManagedPlanPresentationsForSession(session.sessionId, sessionPath);
			expect(await loadManagedPlanPresentations(session)).toEqual([]);
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});
});
