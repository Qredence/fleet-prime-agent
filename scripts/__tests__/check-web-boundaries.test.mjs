import assert from "node:assert/strict";
import test from "node:test";

import {
	findApiHandlerViolations,
	findArbitraryTypeScaleLines,
	findForbiddenImports,
	findLegacyTypeScaleLines,
	findServerSdkImports,
	findServerSdkViolations,
	findWebServerImportViolations,
} from "../check-web-boundaries.mjs";

test("detects comment-separated runtime imports", () => {
	const cases = [
		['const runtime = import/* webpackIgnore: true */("prime-agent");', "prime-agent"],
		[
			'import { runtime } /* comment */ from /* comment */ "@earendil-works/pi-agent-core";',
			"@earendil-works/pi-agent-core",
		],
		['const runtime = require/* comment */("@earendil-works/pi-ai/runtime");', "@earendil-works/pi-ai"],
	];

	for (const [source, packageName] of cases) {
		assert.deepEqual(findForbiddenImports(source), [{ line: 1, packageName }]);
	}
});

test("preserves static import and export detection", () => {
	const source = `
import "prime-agent";
import { render } from "@earendil-works/pi-tui/render";
export { model } from "@earendil-works/pi-ai";
`;

	assert.deepEqual(findForbiddenImports(source), [
		{ line: 2, packageName: "prime-agent" },
		{ line: 3, packageName: "@earendil-works/pi-tui" },
		{ line: 4, packageName: "@earendil-works/pi-ai" },
	]);
});

test("ignores comments, strings, and similarly named packages", () => {
	const source = `
// import "prime-agent";
const example = 'require("@earendil-works/pi-ai")';
import "prime-agent-compatible";
`;

	assert.deepEqual(findForbiddenImports(source), []);
});

test("restricts server imports to API routes, including types, re-exports and dynamic imports", () => {
	for (const source of [
		'import { handler } from "@prime-agent/web-server";',
		'import type { PrimeBridge } from "@prime-agent/web-server";',
		'export * from "@prime-agent/web-server/private";',
		'const server = import /* server */ ("@prime-agent/web-server");',
		'const server = require("@prime-agent/web-server");',
		'import { PrimeBridge } from "../../../../server/src/prime-bridge";',
	]) {
		assert.notEqual(
			findWebServerImportViolations("web/app/src/components/chat/example.ts", source).length,
			0,
			source,
		);
		assert.deepEqual(findWebServerImportViolations("web/app/src/routes/api/chat.ts", source), []);
	}
	assert.deepEqual(
		findWebServerImportViolations("web/app/src/lib/example.ts", 'import { X } from "@prime-agent/web-protocol";'),
		[],
	);
});

test("flags arbitrary type-scale utilities in product UI", () => {
	assert.deepEqual(findArbitraryTypeScaleLines('className="text-[0.625rem] text-muted-foreground"'), [1]);
	assert.deepEqual(findArbitraryTypeScaleLines('className="text-xs text-muted-foreground"'), []);
});

test("flags legacy custom type-scale classes while ignoring comments and custom properties", () => {
	const source = `
// bare \`text-caption\` in comment should be ignored
const cssVar = "--text-caption";
const valid = "text-xs text-sm text-body-sm";
const bad1 = <span className="text-micro text-muted-foreground" />;
const bad2 = cn("px-2", active ? "text-label" : "text-body");
const bad3 = \`flex \${dense && "text-headline"}\`;
`;
	assert.deepEqual(findLegacyTypeScaleLines(source), [5, 6, 7]);
});

const handlerPath = "web/server/src/handlers/example.ts";

test("requires every HTTP handler to defer work to the wrapper with its actual request", () => {
	for (const declaration of [
		"export function handlePost(request: Request) { return wrapApiHandler(async () => Response.json({})); }",
		"export function handlePost(request: Request) { return wrapApiHandler(async () => Response.json({}), undefined); }",
		"export function handlePost(request: Request) { return wrapApiHandler(async () => Response.json({}), anotherRequest); }",
		"export function handlePost(request: Request) { return Response.json({}); }",
		"export function handlePost(request: Request) { mutate(); return wrapApiHandler(async () => Response.json({}), request); }",
		"export const handlePost = (request: Request) => Response.json({});",
		"export default function handlePost(request: Request) { return Response.json({}); }",
		"export { unguarded as handlePost };",
	]) {
		assert.notEqual(findApiHandlerViolations(handlerPath, declaration).length, 0, declaration);
	}
});

test("allows guarded function and arrow handlers, including comment-separated calls", () => {
	for (const declaration of [
		"export function handlePost(request: Request) { return wrapApiHandler /* guard */ (async () => Response.json({}), request); }",
		"export const handlePost = (request: Request) => wrapApiHandler(async () => Response.json({}), request);",
		"export function handlePost(_request: Request) { return wrapApiHandler(async () => Response.json({}), _request); }",
	])
		assert.deepEqual(findApiHandlerViolations(handlerPath, declaration), []);
});

test("prevents raw session lookup from escaping the access module", () => {
	for (const expression of [
		"bridge.getSession(id)",
		"bridge.resumeSessionById(id)",
		"bridge.resumeSessionByPath(path)",
		'bridge["getSession"](id)',
		"bridge.getSession",
	]) {
		assert.notEqual(findApiHandlerViolations(handlerPath, `const session = ${expression};`).length, 0);
		assert.deepEqual(
			findApiHandlerViolations("web/server/src/handlers/session-access.ts", `const session = ${expression};`),
			[],
		);
	}
	assert.notEqual(findApiHandlerViolations(handlerPath, "const { getSession: lookup } = bridge;").length, 0);
	for (const path of ["web/server/src/handlers/projects.ts", "web/server/src/handlers/chat-sessions.ts"]) {
		assert.deepEqual(findApiHandlerViolations(path, "const live = bridge.getSession(session.sessionId);"), []);
		assert.notEqual(findApiHandlerViolations(path, "const live = bridge.getSession(body.sessionId);").length, 0);
	}
});

test("catches direct session commands that never resolve checked access", () => {
	const unguarded = `export function handlePost(request: Request) {
		return wrapApiHandler(async () => { await bridge.exportSession(body.sessionId); return Response.json({}); }, request);
	}`;
	assert.match(findApiHandlerViolations(handlerPath, unguarded)[0], /must await requireSession/);
	const guarded = unguarded.replace(
		"await bridge.exportSession",
		"const session = await requireSession(body.sessionId); if (!session) return new Response(null, { status: 404 }); await bridge.exportSession",
	);
	assert.deepEqual(findApiHandlerViolations(handlerPath, guarded), []);
});

test("rejects session work before the access check and protects new bridge methods by default", () => {
	for (const operation of [
		"bridge.exportSession(id)",
		"getBridge().newSessionOperation(id)",
		"adapter.newSessionOperation(id)",
	]) {
		const source = `export function handlePost(request: Request) {
			return wrapApiHandler(async () => {
				const adapter = getBridge();
				await ${operation};
				await requireSession(id);
				return Response.json({});
			}, request);
		}`;
		assert.match(findApiHandlerViolations(handlerPath, source)[0], /must await requireSession/);
	}
});

test("allows global configuration reloads without treating them as session-id operations", () => {
	const source = `export function handlePost(request: Request) {
		return wrapApiHandler(async () => { await getBridge().reloadResources(); return Response.json({}); }, request);
	}`;
	assert.deepEqual(findApiHandlerViolations(handlerPath, source), []);
});

const bridge = "web/server/src/legacy/prime-agent-sdk.ts";

test("lists the names each SDK import binds", () => {
	const source = `
import type { AgentConnection, SessionSummary as Summary } from "prime-agent";
import * as ai from "@earendil-works/pi-ai";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import { z } from "zod";
`;
	assert.deepEqual(findServerSdkImports(source), [
		{ line: 2, specifier: "prime-agent", name: "AgentConnection" },
		{ line: 2, specifier: "prime-agent", name: "SessionSummary" },
		{ line: 3, specifier: "@earendil-works/pi-ai", name: "*" },
		{ line: 4, specifier: "@earendil-works/pi-ai/oauth", name: "getOAuthProvider" },
	]);
});

test("routes legacy SDK config and session classes through the R1b bridge", () => {
	const source = 'import { AuthStorage, SessionManager } from "prime-agent";\n';
	assert.deepEqual(findServerSdkViolations("web/server/src/handlers/new.ts", source, {}), [
		`web/server/src/handlers/new.ts:1 imports AuthStorage from prime-agent; use ${bridge}`,
		`web/server/src/handlers/new.ts:1 imports SessionManager from prime-agent; use ${bridge}`,
	]);
	assert.deepEqual(findServerSdkViolations(bridge, source, {}), []);
});

test("freezes other SDK imports at the baseline", () => {
	const baseline = { "web/server/src/event-mapper.ts": ["prime-agent#AgentConnectionEvent"] };
	assert.deepEqual(
		findServerSdkViolations(
			"web/server/src/event-mapper.ts",
			'import type { AgentConnectionEvent } from "prime-agent";\n',
			baseline,
		),
		[],
	);
	assert.deepEqual(
		findServerSdkViolations(
			"web/server/src/event-mapper.ts",
			'import type { AgentConnectionEvent, AgentEvent } from "prime-agent";\n',
			baseline,
		),
		[
			"web/server/src/event-mapper.ts:1 adds AgentEvent from prime-agent; new Prime Agent SDK imports are frozen until the R1 cutover",
		],
	);
	assert.deepEqual(
		findServerSdkViolations("web/server/src/new-file.ts", 'const sdk = await import("prime-agent");\n', baseline),
		[
			"web/server/src/new-file.ts:1 adds * from prime-agent; new Prime Agent SDK imports are frozen until the R1 cutover",
		],
	);
});

test("lets tests build fixtures with the SDK but never import retired symbols", () => {
	const fixtureWriter = 'import { SessionManager } from "prime-agent";\n';
	assert.deepEqual(findServerSdkViolations("web/server/src/__tests__/x.test.ts", fixtureWriter, {}), []);
	const retired = 'import { IpythonKernelProvisioner } from "prime-agent";\n';
	assert.deepEqual(findServerSdkViolations("web/server/src/__tests__/x.test.ts", retired, {}), [
		"web/server/src/__tests__/x.test.ts:1 imports IpythonKernelProvisioner, which Fleet no longer uses",
	]);
	assert.deepEqual(findServerSdkViolations(bridge, retired, {}), [
		`${bridge}:1 imports IpythonKernelProvisioner, which Fleet no longer uses`,
	]);
});
