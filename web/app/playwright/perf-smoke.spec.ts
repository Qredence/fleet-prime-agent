import { test, expect } from "@playwright/test"

// Perf smoke: runtime mirror of web/app/scripts/check-bundle-budget.mjs.
//
// While the budget script audits the static import graph at build time, this
// spec asserts the same invariant at runtime: loading `/` must not fetch the
// heavy deferred chunks (panels, OpenUI renderer, charts, syntax
// highlighting), and first paint must land within an LCP budget.
const FORBIDDEN_CHUNK_PATTERNS = [
	/openui-renderer/i,
	/settings-dialog/i,
	/markdown-code/i,
	/artifacts-panel/i,
	/resources-panel/i,
	/session-insights-panel/i,
	/workspace-panel/i,
	/fleet-tool-timeline/i,
	/fleet-subagent-list/i,
	/fleet-reasoning-panel/i,
	/prompt-suggestions/i,
	/fleet-message-queue/i,
	/agent-activity/i,
	/model-selector-list/i,
	/command-/i,
]

test.describe("performance smoke", () => {
	test("welcome load fetches no deferred chunks", async ({ page }) => {
		const forbidden: Array<string> = []
		page.on("response", (response) => {
			const url = response.url()
			if (!url.endsWith(".js")) return
			const file = url.split("/").pop() ?? url
			if (FORBIDDEN_CHUNK_PATTERNS.some((pattern) => pattern.test(file))) {
				forbidden.push(file)
			}
		})

		await page.goto("/")
		const composer = page.locator('textarea, [contenteditable="true"], [data-chat-input]')
		await expect(composer.first()).toBeVisible({ timeout: 15_000 })
		// Let any eager follow-up fetches settle.
		await page.waitForTimeout(2_000)

		expect(forbidden).toEqual([])
	})

	test("welcome LCP stays within budget", async ({ page }) => {
		await page.goto("/")
		const composer = page.locator('textarea, [contenteditable="true"], [data-chat-input]')
		await expect(composer.first()).toBeVisible({ timeout: 15_000 })

		const lcp = await page.evaluate(
			() =>
				new Promise<number>((resolve) => {
					const timeout = setTimeout(() => resolve(-1), 10_000)
					new PerformanceObserver((list, observer) => {
						for (const entry of list.getEntries()) {
							clearTimeout(timeout)
							observer.disconnect()
							resolve(entry.startTime)
							return
						}
					}).observe({ type: "largest-contentful-paint", buffered: true })
				}),
		)

		expect(lcp).toBeGreaterThanOrEqual(0)
		expect(lcp).toBeLessThan(4_000)
	})
})
