import assert from "node:assert/strict";
import { delimiter, dirname } from "node:path";
import test from "node:test";
import { trustedPathString } from "../trusted-exec-env.mjs";

test("trustedPathString includes the active Node toolchain bin directory", () => {
	if (process.platform === "win32") {
		assert.ok(trustedPathString());
		return;
	}
	const segments = trustedPathString().split(delimiter);
	assert.equal(segments[0], dirname(process.execPath));
	assert.ok(segments.includes("/usr/bin"));
});
