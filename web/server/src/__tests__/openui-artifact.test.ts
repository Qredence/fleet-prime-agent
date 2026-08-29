import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_OPENUI_HTML_ARTIFACT_BYTES,
	validateAndNormalizeOpenUIHtmlArtifact,
} from "@prime-agent/web-protocol/openui-artifact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatOpenUIArtifactPut } from "../handlers/chat-openui-artifact";
import {
	loadManagedPrimePresentation,
	stablePresentationId,
	writeManagedPrimePresentation,
} from "../prime-agent-presentation";
import type { BridgeSession, PrimeBridge } from "../prime-bridge";
import { resetBridgeForTests, setBridgeForTests } from "../singleton";

const VALID_DOCUMENT = `<!doctype html>
<html>
  <head><style>body { color: #123; }</style></head>
  <body><h1>Fleet Agent</h1><script>document.body.dataset.ready = "yes";</script></body>
</html>`;

function emptyPresentation() {
	return {
		revision: 0,
		userBash: [],
		rlmChildren: [],
		refinements: [],
		artifactRuns: [],
	};
}

function requestBody(document = VALID_DOCUMENT) {
	return {
		sessionId: "session-1",
		assistantMessageId: "streamed-assistant-1",
		artifactIndex: 0,
		artifact: { title: "Fleet Agent architecture", document },
	};
}

describe("validateAndNormalizeOpenUIHtmlArtifact", () => {
	it("normalizes a fragment and adds a restrictive document CSP", () => {
		const result = validateAndNormalizeOpenUIHtmlArtifact({ title: "Status", document: "<p>Ready</p>" });

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) return;
		expect(result.value.document).toContain("<!doctype html>");
		expect(result.value.document).toContain("default-src 'none'");
		expect(result.value.document).toContain("connect-src 'none'");
		expect(result.value.document).toContain("form-action 'none'");
	});

	it.each([
		["body markup", (meta: string) => `<!doctype html><html><body>${meta}</body></html>`],
		[
			"script text",
			(meta: string) =>
				`<!doctype html><html><body><script>const canonicalPolicy = \`${meta}\`;</script></body></html>`,
		],
	] as const)("injects the canonical CSP into head when its text appears in %s", (_label, createDocument) => {
		const seed = validateAndNormalizeOpenUIHtmlArtifact({ title: "Seed", document: "<p>ready</p>" });
		expect(seed.ok).toBe(true);
		if (!seed.ok) return;
		const canonicalMeta = seed.value.document.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0];
		expect(canonicalMeta).toBeTruthy();
		if (!canonicalMeta) return;

		const result = validateAndNormalizeOpenUIHtmlArtifact({
			title: "CSP placement",
			document: createDocument(canonicalMeta),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const head = result.value.document.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
		expect(head).toContain(canonicalMeta);
	});

	it("accepts its normalized document again without changing it", () => {
		const first = validateAndNormalizeOpenUIHtmlArtifact({ title: "Status", document: "<p>Ready</p>" });

		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const second = validateAndNormalizeOpenUIHtmlArtifact(first.value);

		expect(second).toEqual(first);
	});

	it("accepts escaped markup and data images without executing host HTML", () => {
		const result = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Escaped",
			document: '<p>&lt;script&gt;alert("no")&lt;/script&gt;</p><img src="data:image/png;base64,AAAA">',
		});

		expect(result.ok).toBe(true);
	});

	it("allows explanatory text that mentions restricted capabilities", () => {
		const result = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Safe notes",
			document:
				'<p>Downloads and new-window navigation are disabled.</p><div data-copy="A download link is intentionally unavailable."></div>',
		});

		expect(result.ok).toBe(true);
	});

	it.each([
		["external frames", '<iframe src="https://example.com"></iframe>'],
		["external scripts", '<script src="https://example.com/app.js"></script>'],
		["event handlers", '<button onclick="alert(1)">Run</button>'],
		["unsafe resource URLs", '<img src="javascript:alert(1)">'],
		["external CSS", '<style>@import url("https://example.com/app.css");</style>'],
		["custom CSP metadata", '<meta http-equiv="Content-Security-Policy" content="default-src https:">'],
		["refresh metadata", '<meta http-equiv="refresh" content="0;url=https://example.com">'],
		["network APIs", '<script>fetch("https://example.com")</script>'],
		["forms", '<form action="#submit"><input></form>'],
		["popups", '<script>window.open("#popup")</script>'],
		["navigation APIs", '<script>window.location.href = "https://example.com"</script>'],
		["downloads", '<a href="#file" download="report">Download</a>'],
	] as const)("rejects %s", (_label, document) => {
		expect(validateAndNormalizeOpenUIHtmlArtifact({ title: "Unsafe", document }).ok).toBe(false);
	});

	it("allows CSS url() values limited to safe data images", () => {
		const quoted = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Safe CSS url quoted",
			document: '<style>body { background: url("data:image/png;base64,AAAA"); }</style>',
		});
		expect(quoted.ok).toBe(true);

		const unquoted = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Safe CSS url unquoted",
			document: "<style>body { background: url(data:image/png;base64,AAAA); }</style>",
		});
		expect(unquoted.ok).toBe(true);
	});

	it("rejects CSS url() values that reference external or unsafe resources", () => {
		const external = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Unsafe CSS url",
			document: '<style>body { background: url("https://example.com/x.png"); }</style>',
		});
		expect(external.ok).toBe(false);

		const empty = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Empty CSS url",
			document: "<style>body { background: url(); }</style>",
		});
		expect(empty.ok).toBe(false);
	});

	it("parses quoted CSS url() values containing parentheses without truncation", () => {
		const result = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Parentheses inside quoted CSS url",
			document: '<style>body { background: url("data:image/svg+xml;utf8,<svg>()"); }</style>',
		});
		expect(result.ok).toBe(true);
	});

	it("rejects malformed quoted CSS url() values via the unquoted fallback", () => {
		const result = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Malformed quoted CSS url",
			document: '<style>body { background: url("https://example.com" x); }</style>',
		});
		expect(result.ok).toBe(false);
	});

	it("validates adversarial unclosed CSS url() input in bounded time", () => {
		const document = `<style>body { background: url(${" ".repeat(200_000)}</style>`;
		const started = performance.now();
		const result = validateAndNormalizeOpenUIHtmlArtifact({ title: "Unclosed CSS url", document });
		const elapsed = performance.now() - started;

		expect(result.ok).toBe(true);
		expect(elapsed).toBeLessThan(2_000);
	});

	it("enforces the UTF-8 size limit before normalization", () => {
		const result = validateAndNormalizeOpenUIHtmlArtifact({
			title: "Large",
			document: "x".repeat(MAX_OPENUI_HTML_ARTIFACT_BYTES),
		});

		expect(result).toMatchObject({ ok: false, status: 413 });
	});
});

describe("handleChatOpenUIArtifactPut", () => {
	afterEach(() => {
		resetBridgeForTests();
	});

	it("associates a streamed assistant id with the hydrated assistant and uses a stable key", async () => {
		const presentation = emptyPresentation();
		const upsertPresentationArtifact = vi.fn(async (_sessionId: string, artifact: unknown) => ({
			...presentation,
			revision: 1,
			artifactRuns: [{ id: "run-1", runId: "assistant-openui", artifacts: [artifact] }],
		}));
		const session = {
			sessionId: "session-1",
			sessionPath: "/tmp/session-1.jsonl",
		} as unknown as BridgeSession;
		setBridgeForTests({
			getSession: vi.fn(() => session),
			resumeSessionById: vi.fn(),
			resetForTests: vi.fn(),
			getMessages: vi.fn(async () => [
				{ id: "session-1-m0", role: "user", parts: [{ type: "text", text: "request" }] },
				{ id: "session-1-m1", role: "assistant", parts: [{ type: "text", text: "answer" }] },
			]),
			getPresentation: vi.fn(() => presentation),
			upsertPresentationArtifact,
		} as unknown as PrimeBridge);

		const response = await handleChatOpenUIArtifactPut(
			new Request("http://localhost/api/chat/artifacts", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestBody()),
			}),
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			artifact: { id: string; sourceMessageId?: string; kind: string; input?: { clientMessageId?: string } };
		};
		expect(payload.artifact).toMatchObject({
			sourceMessageId: "session-1-m1",
			kind: "openui-html",
			input: { clientMessageId: "streamed-assistant-1" },
		});
		expect(payload.artifact.id).toBe(stablePresentationId("session-1-m1:openui-html:0"));
		expect(upsertPresentationArtifact).toHaveBeenCalledTimes(1);
	});

	it("returns a client error and never calls the bridge for unsafe or oversized documents", async () => {
		const getSession = vi.fn();
		setBridgeForTests({ getSession, resetForTests: vi.fn() } as unknown as PrimeBridge);

		const unsafe = await handleChatOpenUIArtifactPut(
			new Request("http://localhost/api/chat/artifacts", {
				method: "PUT",
				body: JSON.stringify(requestBody('<script src="https://bad.test/x.js"></script>')),
			}),
		);
		const oversized = await handleChatOpenUIArtifactPut(
			new Request("http://localhost/api/chat/artifacts", {
				method: "PUT",
				body: JSON.stringify(requestBody("x".repeat(MAX_OPENUI_HTML_ARTIFACT_BYTES))),
			}),
		);

		expect(unsafe.status).toBe(400);
		expect(oversized.status).toBe(413);
		expect(getSession).not.toHaveBeenCalled();
	});
});

describe("PrimeBridge OpenUI artifact persistence", () => {
	it("writes an idempotent artifact to the presentation sidecar", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-openui-artifact-"));
		try {
			const sessionPath = join(root, "sessions", "session.jsonl");
			const presentation = {
				...emptyPresentation(),
				revision: 1,
				artifactRuns: [
					{
						id: "run-1",
						runId: "assistant-openui",
						artifacts: [
							{
								id: "artifact-1",
								runId: "assistant-openui",
								sourceMessageId: "assistant-1",
								kind: "openui-html" as const,
								title: "Status",
								status: "success" as const,
								input: { artifactIndex: 0 },
								output: { title: "Status", document: VALID_DOCUMENT },
								timestamp: 1,
							},
						],
					},
				],
			};
			await writeManagedPrimePresentation({ sessionPath }, presentation);
			const loaded = await loadManagedPrimePresentation({ sessionPath });
			expect(loaded?.artifactRuns[0]?.artifacts[0]?.kind).toBe("openui-html");
			expect((loaded?.artifactRuns[0]?.artifacts[0]?.output as { document: string }).document).toBe(VALID_DOCUMENT);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
