import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_KERNEL_STDERR_TAIL_BYTES, readKernelStderrTail } from "../prime-agent-presentation";

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
