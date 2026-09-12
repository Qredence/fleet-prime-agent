import assert from "node:assert/strict";
import test from "node:test";

import { findArbitraryTypeScaleLines, findForbiddenImports } from "../check-web-boundaries.mjs";

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
	assert.deepEqual(findArbitraryTypeScaleLines('className="text-caption text-muted-foreground"'), []);
});
