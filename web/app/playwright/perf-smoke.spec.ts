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

const PROJECT_SCOPED_ENDPOINTS = [
	"/api/chat/models",
	"/api/chat/resources",
	"/api/chat/commands",
	"/api/chat/settings",
	"/api/workspace/tree",
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

	test("welcome scopes project requests and refreshes sessions once", async ({ page }) => {
		const projectRequests: Array<URL> = []
		let sessionListRequests = 0
		page.on("request", (request) => {
			if (request.method() !== "GET") return
			const url = new URL(request.url())
			if (PROJECT_SCOPED_ENDPOINTS.includes(url.pathname)) projectRequests.push(url)
			if (url.pathname === "/api/chat/sessions" && !url.searchParams.has("projectId")) {
				sessionListRequests += 1
			}
		})

		await page.goto("/")
		const composer = page.locator('textarea, [contenteditable="true"], [data-chat-input]')
		await expect(composer.first()).toBeVisible({ timeout: 15_000 })
		await page.waitForTimeout(2_000)

		expect(sessionListRequests).toBe(1)
		for (const endpoint of PROJECT_SCOPED_ENDPOINTS) {
			const requests = projectRequests.filter((url) => url.pathname === endpoint)
			expect(requests.length, `${endpoint} request count`).toBeLessThanOrEqual(1)
			for (const url of requests) {
				expect(url.searchParams.get("projectId"), `${endpoint} project scope`).toBeTruthy()
			}
		}
	})

	test("welcome LCP stays within budget", async ({ page }) => {
		await page.goto("/")
		const composer = page.locator('textarea, [contenteditable="true"], [data-chat-input]')
		await expect(composer.first()).toBeVisible({ timeout: 15_000 })

		const lcpPromise = page.evaluate(
			() =>
				new Promise<number>((resolve) => {
					let latest = -1
					let observer: PerformanceObserver
					let settled = false
					const updateLatest = (entries: PerformanceEntryList) => {
						const entry = entries[entries.length - 1]
						if (entry) latest = entry.startTime
					}
					const finish = () => {
						if (settled) return
						settled = true
						updateLatest(observer.takeRecords())
						observer.disconnect()
						for (const eventName of interactionEvents) {
							window.removeEventListener(eventName, finishOnInteraction, true)
						}
						document.removeEventListener("visibilitychange", finishOnVisibilityChange)
						window.removeEventListener("pagehide", finish)
						resolve(latest)
					}
					const finishOnInteraction = () => finish()
					const finishOnVisibilityChange = () => {
						if (document.visibilityState === "hidden") finish()
					}
					const interactionEvents = ["pointerdown", "keydown", "touchstart"] as const
					observer = new PerformanceObserver((list) => {
						updateLatest(list.getEntries())
					})
					observer.observe({ type: "largest-contentful-paint", buffered: true })
					for (const eventName of interactionEvents) {
						window.addEventListener(eventName, finishOnInteraction, true)
					}
					document.addEventListener("visibilitychange", finishOnVisibilityChange)
					window.addEventListener("pagehide", finish)
				}),
		)
		await composer.first().click()
		const lcp = await lcpPromise

		expect(lcp).toBeGreaterThanOrEqual(0)
		expect(lcp).toBeLessThan(4_000)
	})

	test("welcome reports usable Web Vitals", async ({ page }) => {
		await page.goto("/")
		const composer = page.locator('textarea, [contenteditable="true"], [data-chat-input]')
		await expect(composer.first()).toBeVisible({ timeout: 15_000 })
		await page.waitForFunction(
			() =>
				Boolean(
					(window as Window & {
						__fleetVitalsInit?: boolean
					}).__fleetVitalsInit,
				),
			{ timeout: 15_000 },
		)
		await page.waitForTimeout(250)
		await page.evaluate(() => window.dispatchEvent(new Event("pagehide")))

		const vitals = await page.evaluate(
			() =>
				(window as Window & {
					__fleetVitals?: Array<{ name: string; value: number; url: string }>
				}).__fleetVitals ?? [],
		)
		expect(vitals.some((vital) => vital.name === "LCP")).toBe(true)
		expect(vitals.every((vital) => Number.isFinite(vital.value) && vital.value >= 0)).toBe(true)
		expect(vitals.find((vital) => vital.name === "LCP")?.value ?? Infinity).toBeLessThan(4_000)
	})
})
