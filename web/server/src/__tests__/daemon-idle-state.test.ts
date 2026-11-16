import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { z } from "zod";
import { isIdleConnectionState } from "../daemon-protocol";

it("recognizes recorded Rust idle state without the legacy SDK retryAttempt field", async () => {
	const frames = z
		.array(z.object({ response: z.object({ data: z.unknown().optional() }) }))
		.parse(
			JSON.parse(
				await readFile(
					new URL("./fixtures/daemon-frames/rust-v0.10.1/telemetry-disabled-attach.json", import.meta.url),
					"utf8",
				),
			),
		);
	const state = frames[0]!.response.data;
	expect(isIdleConnectionState(state)).toBe(true);
	for (const flag of ["isRunningTools", "hasRunningSubagents", "isQuotaParked"]) {
		expect(isIdleConnectionState({ ...(state as Record<string, unknown>), [flag]: true })).toBe(false);
	}
	expect(isIdleConnectionState({ ...(state as Record<string, unknown>), unfinishedActionCount: 1 })).toBe(false);
	expect(isIdleConnectionState({ ...(state as Record<string, unknown>), activity: "working" })).toBe(false);
});

it("does not detach when required idle signals are absent or malformed", () => {
	for (const state of [
		undefined,
		{},
		{ isStreaming: false },
		{ isStreaming: "false", isCompacting: false, isBashRunning: false, sessionActions: { queuedCount: 0 } },
	]) {
		expect(isIdleConnectionState(state)).toBe(false);
	}
});
