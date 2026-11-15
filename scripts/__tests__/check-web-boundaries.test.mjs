import assert from "node:assert/strict";
import test from "node:test";

import {
	findArbitraryTypeScaleLines,
	findForbiddenImports,
	findLegacyTypeScaleLines,
	findServerSdkImports,
	findServerSdkViolations,
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
