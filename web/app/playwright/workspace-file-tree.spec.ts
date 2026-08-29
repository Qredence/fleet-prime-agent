import { expect, test, type Page } from "@playwright/test"

const workspace = {
	root: "/workspace/prime-agent",
	nodes: [
		{
			name: "docs",
			path: "docs",
			type: "directory",
			children: [
				{
					name: "README.md",
					path: "docs/README.md",
					type: "file",
				},
				{
					name: "guides",
					path: "docs/guides",
					type: "directory",
					children: [
						{
							name: "intro.md",
							path: "docs/guides/intro.md",
							type: "file",
						},
					],
				},
			],
		},
		{
			name: "artifacts",
			path: "artifacts",
			type: "directory",
			children: [
				{
					name: "trace.md",
					path: "artifacts/trace.md",
					type: "file",
				},
			],
		},
		{
			name: "notes.md",
			path: "notes.md",
			type: "file",
		},
	],
	diagnostics: [],
} as const

async function mockWorkspaceApis(page: Page) {
	await page.route("**/api/workspace/tree**", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(workspace),
		})
	})
	await page.route("**/api/workspace/file**", async (route) => {
		const path = new URL(route.request().url()).searchParams.get("path") ?? ""
		const name = path.split("/").at(-1) ?? path
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				path,
				name,
				content: "# Mock README\n\nMock README preview",
				mediaType: "text/markdown",
				status: "ok",
			}),
		})
	})
}

async function clickCenter(page: Page, locator: ReturnType<Page["locator"]>) {
	const box = await locator.boundingBox()
	expect(box).not.toBeNull()
	if (!box) return
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

function collectBrowserErrors(page: Page) {
	const errors: Array<string> = []
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text())
	})
	page.on("pageerror", (error) => errors.push(error.message))
	return errors
}

test.describe("workspace file tree", () => {
	test("supports desktop folder, file, and keyboard interactions", async ({ page }) => {
		const browserErrors = collectBrowserErrors(page)
		await page.setViewportSize({ width: 1400, height: 900 })
		await mockWorkspaceApis(page)
		await page.goto("/")
		await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible({ timeout: 15_000 })
		await page.waitForLoadState("networkidle")

		await clickCenter(page, page.getByRole("button", { name: "Open side panel", exact: true }))
		const canvas = page.getByTestId("pi-workspace-canvas")
		await expect(canvas).toBeVisible()
		await expect(canvas).toHaveCSS("transform", "none")
		const tree = canvas.getByRole("tree", { name: "Workspace files" })
		await expect(tree).toBeVisible()

		const docs = tree.getByRole("treeitem", { name: "docs", exact: true })
		await expect(docs).toHaveAttribute("aria-expanded", "false")
		await docs.click()
		await expect(docs).toHaveAttribute("aria-expanded", "true")
		await expect(docs).toHaveAttribute("aria-selected", "false")
		const guides = tree.getByRole("treeitem", { name: "guides", exact: true })
		await guides.click()
		await expect(guides).toHaveAttribute("aria-expanded", "true")
		await expect(guides).toHaveAttribute("aria-selected", "false")
		await expect(tree.getByRole("treeitem", { name: "intro.md", exact: true })).toBeVisible()

		const readme = tree.getByRole("treeitem", { name: "README.md", exact: true })
		await readme.click()
		await expect(readme).toHaveAttribute("aria-selected", "true")
		await expect(canvas.getByTestId("workspace-preview")).toContainText("README.md")
		await expect(canvas.getByTestId("workspace-preview")).toContainText("Mock README preview")

		await docs.focus()
		await docs.press("ArrowRight")
		await expect(readme).toBeFocused()
		await readme.press("ArrowLeft")
		await expect(docs).toBeFocused()
		await docs.press(" ")
		await expect(docs).toHaveAttribute("aria-expanded", "false")
		await expect(readme).toBeHidden()
		await docs.press("ArrowRight")
		await docs.press("ArrowRight")
		await expect(readme).toBeFocused()
		await readme.press("Enter")

		await page.getByRole("tab", { name: "Workspace artifacts", exact: true }).click()
		const artifactsCanvas = page.getByTestId("pi-artifacts-canvas")
		await expect(artifactsCanvas).toBeVisible()
		const artifactsTree = artifactsCanvas.getByTestId("artifacts-tree").getByRole("tree", {
			name: "Files in artifacts",
		})
		await expect(artifactsTree).toBeVisible()
		await expect(artifactsTree.getByRole("treeitem", { name: "docs", exact: true })).toHaveCount(0)
		const trace = artifactsTree.getByRole("treeitem", { name: "trace.md", exact: true })
		await trace.click()
		await expect(trace).toHaveAttribute("aria-selected", "true")
		await expect(artifactsCanvas.getByTestId("workspace-preview")).toContainText("trace.md")

		expect(
			await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
		).toBe(true)
		expect(browserErrors).toEqual([])
	})

	test("keeps the tree usable in the stacked mobile panel", async ({ page }) => {
		const browserErrors = collectBrowserErrors(page)
		await page.setViewportSize({ width: 390, height: 844 })
		await mockWorkspaceApis(page)
		await page.goto("/")
		await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible({ timeout: 15_000 })
		await page.waitForLoadState("networkidle")

		await page.getByRole("tab", { name: "Workspace", exact: true }).click()
		const dialog = page.getByRole("dialog", { name: "Workspace", exact: true })
		await expect(dialog).toBeVisible()
		const tree = dialog.getByRole("tree", { name: "Workspace files" })
		await expect(tree).toBeVisible()
		await expect(dialog.getByTestId("workspace-tree-resize-handle")).toBeHidden()

		const split = dialog.locator("div.relative.grid").first()
		expect(
			await split.evaluate((element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length),
		).toBe(1)

		await tree.getByRole("treeitem", { name: "docs", exact: true }).click()
		await tree.getByRole("treeitem", { name: "README.md", exact: true }).click()
		await expect(dialog.getByTestId("workspace-preview")).toContainText("Mock README preview")
		expect(
			await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
		).toBe(true)
		expect(browserErrors).toEqual([])
	})
})
