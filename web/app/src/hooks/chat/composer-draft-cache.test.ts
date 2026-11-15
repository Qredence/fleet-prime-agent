import { describe, expect, it } from "vitest";
import { COMPOSER_DRAFT_CACHE_LIMIT, createDraftCache, draftCacheKey } from "@/hooks/chat/composer-assistance";

describe("draftCacheKey", () => {
	it("collapses whitespace and case so one question has one key", () => {
		expect(draftCacheKey("  Refactor   the   Composer ")).toBe(draftCacheKey("refactor the composer"));
	});

	it("separates drafts that differ in wording", () => {
		expect(draftCacheKey("refactor the composer")).not.toBe(draftCacheKey("refactor the composer please"));
	});
});

describe("createDraftCache", () => {
	it("reads back what was remembered", () => {
		const cache = createDraftCache<number>();

		cache.remember("a", 1);

		expect(cache.read("a")).toBe(1);
		expect(cache.read("b")).toBeUndefined();
	});

	it("expires an entry once the TTL has passed", () => {
		let now = 0;
		const cache = createDraftCache<string>({ ttlMs: 1_000, now: () => now });

		cache.remember("a", "offer");
		now = 999;
		expect(cache.read("a")).toBe("offer");

		now = 1_001;
		expect(cache.read("a")).toBeUndefined();
	});

	it("evicts the least recently read entry at the limit", () => {
		let now = 0;
		const cache = createDraftCache<number>({ limit: 3, now: () => now });

		cache.remember("a", 1);
		cache.remember("b", 2);
		cache.remember("c", 3);
		// Reading `a` makes `b` the eviction candidate.
		expect(cache.read("a")).toBe(1);

		now = 1;
		cache.remember("d", 4);

		expect(cache.read("b")).toBeUndefined();
		expect(cache.read("a")).toBe(1);
		expect(cache.read("c")).toBe(3);
		expect(cache.read("d")).toBe(4);
	});

	it("re-remembering a key refreshes it instead of duplicating it", () => {
		let now = 0;
		const cache = createDraftCache<number>({ limit: 2, now: () => now });

		cache.remember("a", 1);
		cache.remember("b", 2);
		now = 1;
		cache.remember("a", 10);
		now = 2;
		cache.remember("c", 3);

		expect(cache.read("a")).toBe(10);
		expect(cache.read("c")).toBe(3);
		expect(cache.read("b")).toBeUndefined();
	});

	it("stays bounded at the default limit", () => {
		const cache = createDraftCache<number>();

		for (let index = 0; index < COMPOSER_DRAFT_CACHE_LIMIT + 10; index += 1) cache.remember(`k${index}`, index);

		expect(cache.read("k0")).toBeUndefined();
		expect(cache.read(`k${COMPOSER_DRAFT_CACHE_LIMIT + 9}`)).toBe(COMPOSER_DRAFT_CACHE_LIMIT + 9);
	});

	it("clears every entry", () => {
		const cache = createDraftCache<number>();

		cache.remember("a", 1);
		cache.clear();

		expect(cache.read("a")).toBeUndefined();
	});
});
