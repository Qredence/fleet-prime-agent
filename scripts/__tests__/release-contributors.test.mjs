import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	collectContributors,
	contributorsFromPullRequests,
	contributorsSection,
	isHumanContributor,
	mergeReadmeContributors,
	pullRequestsBetween,
	README_CONTRIBUTORS_END,
	README_CONTRIBUTORS_START,
	readmeContributors,
	writeReadmeContributors,
} from "../release-contributors.mjs";

/**
 * Builds a merged pull request as the GitHub API returns it.
 * @param {number} number - Pull request number.
 * @param {string} login - Author login.
 * @param {object} [overrides] - Fields to override.
 * @returns {object} The pull request.
 */
function merged(number, login, overrides = {}) {
	return {
		number,
		user: { login, type: "User" },
		merged_at: "2026-10-31T16:19:44Z",
		base: { ref: "main" },
		head: { ref: `feature/${number}` },
		...overrides,
	};
}

const readmeFixture = [
	"# Project",
	"",
	"## Contributors",
	"",
	README_CONTRIBUTORS_START,
	"- [@mikemikimike](https://github.com/mikemikimike)",
	"- [@Zochory](https://github.com/Zochory)",
	README_CONTRIBUTORS_END,
	"",
	"## Support",
	"",
].join("\n");

test("recognises people and rejects bots, automation, and AI identities", () => {
	assert.equal(isHumanContributor({ login: "Zochory", type: "User" }), true);
	assert.equal(isHumanContributor({ login: "mikemikimike" }), true);
	for (const login of ["dependabot[bot]", "github-actions[bot]", "coderabbitai[bot]"]) {
		assert.equal(isHumanContributor({ login, type: "Bot" }), false, login);
	}
	for (const login of [
		"dependabot",
		"github-actions",
		"claude",
		"Codex",
		"coderabbitai",
		"cursor",
		"gitar",
		"Copilot",
	]) {
		assert.equal(isHumanContributor({ login, type: "User" }), false, login);
	}
	assert.equal(isHumanContributor({ login: "someone", type: "Bot" }), false);
	assert.equal(isHumanContributor({ login: "an-org", type: "Organization" }), false);
	assert.equal(isHumanContributor(null), false);
	assert.equal(isHumanContributor({ login: "" }), false);
	assert.equal(isHumanContributor({ login: "-leading-hyphen" }), false);
	assert.equal(isHumanContributor({ login: "has space" }), false);
});

test("groups merged pull requests by human author in order of first contribution", () => {
	const contributors = contributorsFromPullRequests([
		merged(313, "mikemikimike"),
		merged(306, "Zochory"),
		merged(304, "Zochory"),
		merged(306, "Zochory"),
		merged(320, "dependabot[bot]", { user: { login: "dependabot[bot]", type: "Bot" } }),
	]);
	assert.deepEqual(contributors, [
		{ login: "Zochory", pullRequests: [304, 306] },
		{ login: "mikemikimike", pullRequests: [313] },
	]);
});

test("skips release, unmerged, and off-main pull requests", () => {
	const contributors = contributorsFromPullRequests([
		merged(314, "Zochory", { head: { ref: "release/fleet-v0.10.0" } }),
		merged(321, "newcomer", { merged_at: null }),
		merged(322, "stacked", { base: { ref: "feature/base" } }),
		merged(323, "nobody", { user: null }),
		{ number: "324", user: { login: "string-number" }, merged_at: "x", base: { ref: "main" } },
	]);
	assert.deepEqual(contributors, []);
});

test("treats logins that differ only in case as one contributor", () => {
	assert.deepEqual(contributorsFromPullRequests([merged(2, "Zochory"), merged(5, "zochory")]), [
		{ login: "Zochory", pullRequests: [2, 5] },
	]);
});

test("formats the release-notes section as one bullet per contributor", () => {
	assert.equal(
		contributorsSection([
			{ login: "Zochory", pullRequests: [304, 305, 306, 307] },
			{ login: "mikemikimike", pullRequests: [313] },
		]),
		"## Contributors\n\n- @Zochory (#304, #305, #306, #307)\n- @mikemikimike (#313)",
	);
	assert.equal(contributorsSection([]), undefined);
	assert.equal(contributorsSection(undefined), undefined);
});

test("reads the logins listed in the README", () => {
	assert.deepEqual(readmeContributors(readmeFixture), ["mikemikimike", "Zochory"]);
});

test("adds new contributors to the README in alphabetical order without duplicates", () => {
	const updated = mergeReadmeContributors(readmeFixture, ["zochory", "alice", "dependabot", "Bob"]);
	assert.deepEqual(readmeContributors(updated), ["alice", "Bob", "mikemikimike", "Zochory"]);
	assert.ok(updated.includes("- [@alice](https://github.com/alice)\n"));
	assert.ok(updated.startsWith("# Project\n\n## Contributors\n\n"));
	assert.ok(updated.endsWith(`${README_CONTRIBUTORS_END}\n\n## Support\n`));
});

test("leaves the README byte-for-byte unchanged when nobody is new", () => {
	assert.equal(mergeReadmeContributors(readmeFixture, ["Zochory", "MIKEMIKIMIKE"]), readmeFixture);
	assert.equal(mergeReadmeContributors(readmeFixture, []), readmeFixture);
});

test("refuses a README without the contributors markers", () => {
	assert.throws(() => mergeReadmeContributors("# Project\n", ["alice"]), /contributors:start/);
	assert.throws(
		() => readmeContributors(`${README_CONTRIBUTORS_END}\n${README_CONTRIBUTORS_START}\n`),
		/contributors list/,
	);
});

test("the repository README carries a well-formed contributors list", () => {
	const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
	const listed = readmeContributors(readme);
	assert.ok(listed.length > 0, "README.md must credit at least one contributor");
	assert.ok(
		listed.every((login) => isHumanContributor({ login })),
		"README.md credits a non-human account",
	);
	assert.equal(mergeReadmeContributors(readme, []), readme, "README.md contributors are not in canonical form");
});

test("writes the README only when a contributor is new", () => {
	const directory = mkdtempSync(join(tmpdir(), "fleet-contributors-"));
	const path = join(directory, "README.md");
	try {
		writeFileSync(path, readmeFixture, "utf8");
		assert.equal(writeReadmeContributors([{ login: "Zochory" }], { path }), false);
		assert.equal(readFileSync(path, "utf8"), readmeFixture);
		assert.equal(writeReadmeContributors([{ login: "alice", pullRequests: [1] }], { path }), true);
		assert.deepEqual(readmeContributors(readFileSync(path, "utf8")), ["alice", "mikemikimike", "Zochory"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("collects contributors from the pull requests behind each compared commit", async () => {
	const calls = [];
	const associated = {
		a1: [merged(304, "Zochory")],
		a2: [merged(304, "Zochory")],
		b1: [merged(313, "mikemikimike")],
		c1: [merged(314, "Zochory", { head: { ref: "release/fleet-v0.10.0" } })],
		d1: [],
	};
	const request = async (path) => {
		calls.push(path);
		if (path.includes("/compare/")) {
			return { total_commits: 5, commits: Object.keys(associated).map((sha) => ({ sha })) };
		}
		const sha = /\/commits\/([^/]+)\/pulls/.exec(path)[1];
		return associated[sha];
	};
	const contributors = await collectContributors({
		owner: "Qredence",
		repo: "fleet-prime-agent",
		base: "v0.9.0",
		head: "head-sha",
		request,
	});
	assert.deepEqual(contributors, [
		{ login: "Zochory", pullRequests: [304] },
		{ login: "mikemikimike", pullRequests: [313] },
	]);
	assert.equal(calls[0], "/repos/Qredence/fleet-prime-agent/compare/v0.9.0...head-sha?per_page=100&page=1");
	assert.equal(calls.length, 6);
});

test("pages through comparisons longer than one page", async () => {
	const pages = [];
	const shas = Array.from({ length: 150 }, (_, index) => `sha${index}`);
	const pullRequests = await pullRequestsBetween({
		owner: "o",
		repo: "r",
		base: "v1.0.0",
		head: "main",
		request: async (path) => {
			const page = /[?&]page=(\d+)/.exec(path);
			if (path.includes("/compare/")) {
				pages.push(Number(page[1]));
				const start = (Number(page[1]) - 1) * 100;
				return { total_commits: shas.length, commits: shas.slice(start, start + 100).map((sha) => ({ sha })) };
			}
			return [merged(Number(/sha(\d+)/.exec(path)[1]) + 1, "alice")];
		},
	});
	assert.deepEqual(pages, [1, 2]);
	assert.equal(pullRequests.length, 150);
});

test("propagates a failed lookup so callers can decide how to degrade", async () => {
	await assert.rejects(
		collectContributors({
			owner: "o",
			repo: "r",
			base: "v1.0.0",
			head: "main",
			request: async () => {
				throw new Error("HTTP 403");
			},
		}),
		/HTTP 403/,
	);
});
