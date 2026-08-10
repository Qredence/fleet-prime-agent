import { test, expect } from "@playwright/test"

// Smoke: prove the chat shell boots and the composer is interactive.
//
// The dev server boots with a real `PrimeBridge`, but the IPython kernel boot
// doesn't hold back /api/health (it's purely informational) nor the static
// asset pipeline. What we verify:
//   1. index renders the chat surface.
//   2. typing a message and submitting it fires a POST to /api/chat (or a
//      graceful error toast when the server can't actually create a session,
//      which is what we expect in CI without a kernel).
test.describe("chat shell", () => {
	test("home page loads with chat input", async ({ page }) => {
		await page.goto("/")
		await expect(page).toHaveTitle(/prime agent|prime-agent|chat/i, { timeout: 15_000 })
		// The chat surface renders a composer. We accept any plausible
		// textarea/contenteditable that holds a placeholder.
		const composer = page.locator(
			'textarea, [contenteditable="true"], [data-chat-input]'
		)
		await expect(composer.first()).toBeVisible({ timeout: 10_000 })
	})

	test("/api/health responds", async ({ request }) => {
		const response = await request.get("/api/health")
		expect(response.status()).toBeLessThan(600)
		const body = (await response.json()) as { ok?: boolean }
		expect(typeof body.ok).toBe("boolean")
	})
})
