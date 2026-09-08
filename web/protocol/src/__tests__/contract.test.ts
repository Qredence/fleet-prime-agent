import { describe, expect, it } from "vitest";
import { FLEET_ADAPTER_CAPABILITIES } from "../chat-protocol";
import { validateAndNormalizeOpenUIHtmlArtifact } from "../openui-artifact";
import {
	ChatReasoningPresentationSchema,
	ChatRequestSchema,
	ChatStreamEventSchema,
	FleetAdapterCapabilitiesSchema,
	FleetErrorEnvelopeSchema,
	PrimeAgentSessionPresentationSchema,
} from "../schemas/chat";

const SESSION_ID = "session-01";

describe("ChatStreamEventSchema", () => {
	it("accepts every representative stream frame", () => {
		const message = { id: "m-1", role: "assistant", parts: [{ type: "text", text: "hi" }] };
		const frames = [
			{ type: "start", id: "e-1", runId: "r-1", sessionId: SESSION_ID },
			{ type: "delta", text: "hello" },
			{ type: "tool", part: { type: "tool-Shell", toolCallId: "t-1" } },
			{ type: "state", state: { name: "agent_settled" } },
			{ type: "queue", steering: [], followUp: [] },
			{
				type: "reasoning",
				presentation: {
					runId: "r-1",
					phase: "executing",
					steps: [{ id: "s-1", title: "Running", body: "Working" }],
					visibleSteps: 1,
					streaming: true,
					startedAt: 1,
					restingLabel: "Working",
				},
			},
			{ type: "compaction", phase: "start", reason: "context" },
			{ type: "compaction", phase: "end", reason: "context", aborted: false, willRetry: false },
			{ type: "retry", phase: "start", attempt: 1, maxAttempts: 3, delayMs: 100 },
			{ type: "retry", phase: "end", success: true, attempt: 1 },
			{ type: "done", runId: "r-1", message, sessionId: SESSION_ID },
			{ type: "error", message: "boom" },
		];
		for (const frame of frames) {
			expect(ChatStreamEventSchema.safeParse(frame).success, JSON.stringify(frame)).toBe(true);
		}
	});

	it("rejects unknown frame types and malformed deltas", () => {
		expect(ChatStreamEventSchema.safeParse({ type: "telepathy", text: "hi" }).success).toBe(false);
		expect(ChatStreamEventSchema.safeParse({ type: "delta" }).success).toBe(false);
		expect(ChatStreamEventSchema.safeParse(null).success).toBe(false);
	});
});

describe("FleetAdapterCapabilitiesSchema", () => {
	it("accepts the pinned capabilities", () => {
		expect(FleetAdapterCapabilitiesSchema.safeParse(FLEET_ADAPTER_CAPABILITIES).success).toBe(true);
	});

	it("is forward-tolerant to unknown future features", () => {
		const parsed = FleetAdapterCapabilitiesSchema.safeParse({
			protocolVersion: 1,
			schemaRevision: 1,
			features: ["reasoning-summary-v1", "some-future-feature-v9"],
		});
		expect(parsed.success).toBe(true);
	});

	it("rejects non-positive revisions", () => {
		expect(
			FleetAdapterCapabilitiesSchema.safeParse({ protocolVersion: 0, schemaRevision: 1, features: [] }).success,
		).toBe(false);
	});
});

describe("reasoning presentation boundary", () => {
	it("accepts only controlled phases with labeled steps", () => {
		const parsed = ChatReasoningPresentationSchema.safeParse({
			runId: "r-1",
			phase: "planning",
			steps: [{ id: "s-1", title: "Planning", body: "Considering next step" }],
			visibleSteps: 1,
			streaming: false,
			startedAt: 1,
			restingLabel: "Planning",
		});
		expect(parsed.success).toBe(true);
	});

	it("rejects raw thinking shapes without a controlled presentation", () => {
		expect(ChatReasoningPresentationSchema.safeParse({ runId: "r-1", text: "secret chain of thought" }).success).toBe(
			false,
		);
		expect(
			ChatReasoningPresentationSchema.safeParse({
				runId: "r-1",
				phase: "telepathy",
				steps: [],
				visibleSteps: 0,
				streaming: false,
				startedAt: 1,
				restingLabel: "x",
			}).success,
		).toBe(false);
	});
});

describe("FleetErrorEnvelopeSchema", () => {
	it("accepts known codes and rejects unknown ones", () => {
		expect(FleetErrorEnvelopeSchema.safeParse({ code: "NETWORK_DISCONNECTED", message: "offline" }).success).toBe(
			true,
		);
		expect(FleetErrorEnvelopeSchema.safeParse({ code: "NOPE", message: "x" }).success).toBe(false);
	});
});

describe("ChatRequestSchema", () => {
	it("accepts a minimal turn request", () => {
		expect(ChatRequestSchema.safeParse({ sessionId: SESSION_ID, message: "hi" }).success).toBe(true);
	});
	it("rejects more than 16 attachments", () => {
		const attachments = Array.from({ length: 17 }, (_, index) => ({
			kind: "workspace" as const,
			relativePath: `file-${index}.txt`,
			name: `file-${index}.txt`,
		}));
		expect(ChatRequestSchema.safeParse({ sessionId: SESSION_ID, attachments }).success).toBe(false);
	});
});

describe("validateAndNormalizeOpenUIHtmlArtifact", () => {
	it("normalizes safe html with a restrictive CSP", () => {
		const result = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Demo",
			document: "<div>Hello</div>",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.document).toContain("Content-Security-Policy");
			expect(result.value.document).toContain("<div>Hello</div>");
		}
	});

	it("rejects frames, event handlers, external scripts, and network APIs", () => {
		for (const document of [
			"<iframe src='https://example.com'></iframe>",
			"<div onclick='alert(1)'>x</div>",
			"<script src='https://example.com/x.js'></script>",
			"<script>fetch('https://example.com')</script>",
			"<a href='javascript:alert(1)'>x</a>",
		]) {
			expect(validateAndNormalizeOpenUIHtmlArtifact({ title: "t", document }).ok).toBe(false);
		}
	});

	it("enforces the 1 MiB limit", () => {
		const big = "x".repeat(1_048_577);
		const result = validateAndNormalizeOpenUIHtmlArtifact({ title: "t", document: big });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.status).toBe(413);
	});
});

describe("PrimeAgentSessionPresentationSchema kernelDiagnostics", () => {
	const base = { revision: 0, userBash: [], rlmChildren: [], refinements: [], artifactRuns: [] };
	it("accepts presentations with and without kernel diagnostics", () => {
		expect(PrimeAgentSessionPresentationSchema.safeParse(base).success).toBe(true);
		expect(
			PrimeAgentSessionPresentationSchema.safeParse({
				...base,
				kernelDiagnostics: { truncated: true, tail: "Traceback..." },
			}).success,
		).toBe(true);
	});
	it("rejects malformed kernel diagnostics", () => {
		expect(PrimeAgentSessionPresentationSchema.safeParse({ ...base, kernelDiagnostics: { tail: "x" } }).success).toBe(
			false,
		);
	});
});
