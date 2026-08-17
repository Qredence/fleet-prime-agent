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
		await expect(page).toHaveTitle(/fleet prime|prime agent|prime-agent|chat/i, { timeout: 15_000 })
		// The chat surface renders a composer. We accept any plausible
		// textarea/contenteditable that holds a placeholder.
		const composer = page.locator(
			'textarea, [contenteditable="true"], [data-chat-input]'
		)
		await expect(composer.first()).toBeVisible({ timeout: 10_000 })
	})

	test("empty welcome state launches developer tasks without submitting", async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 })
		await page.goto("/")

		const prompt = page.getByRole("textbox", { name: "Prompt" })
		const welcome = page.locator('section[aria-labelledby="fleet-welcome-title"]')
		await expect(prompt).toBeVisible({ timeout: 15_000 })
		await expect(page.getByRole("heading", { name: "What should Fleet Prime Agent work on?", exact: true })).toBeVisible()
		const eyebrow = welcome.getByText("Qredence", { exact: true })
		await expect(eyebrow).toBeVisible()
		expect(await eyebrow.evaluate((element) => getComputedStyle(element).textTransform)).toBe("none")
		const workspaceLabel = welcome.getByText("fleet-rlm", { exact: true })
		await expect(workspaceLabel).toBeVisible()
		await expect(welcome.getByText("Working in fleet-rlm", { exact: true })).toHaveCount(0)
		expect(await workspaceLabel.evaluate((element) => getComputedStyle(element).fontSize)).toBe("18px")
		const visibleLogo = welcome.locator("img:visible")
		await expect(visibleLogo).toHaveCount(1)
		const logoVariant = await page.locator("html").evaluate((element) =>
			element.classList.contains("dark") ? "dark" : "light",
		)
		await expect(visibleLogo).toHaveAttribute("src", new RegExp(`logo-qredence-${logoVariant}-1\\.svg$`))
		await expect(page.getByText(/Explore the codebase, make changes, and run Prime Agent tools/)).toHaveCount(0)
		await expect(page.getByRole("heading", { name: "Welcome to your workspace", exact: true })).toHaveCount(0)

		for (const label of ["Explore codebase", "Review changes", "Fix an issue", "Plan a feature"]) {
			await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible()
		}
		for (const label of ["Summarize this project", "Explore the workspace", "Find a good next step"]) {
			await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0)
		}

		await expect(prompt).toHaveAttribute(
			"placeholder",
			"Ask Prime to build, investigate, or change something…",
		)
		await expect(prompt).toHaveCount(1)
		await expect(page.getByRole("button", { name: "Add to prompt" })).toBeVisible()
		await expect(page.getByRole("button", { name: "Select mode" })).toBeVisible()
		await expect(page.getByRole("combobox", { name: "Select model and reasoning effort" })).toBeVisible()
		await expect(page.getByRole("button", { name: /Enable OpenUI|Disable OpenUI/ })).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Send prompt" })).toBeVisible()
		await page.waitForLoadState("networkidle")

		const chatColumn = page.getByTestId("chat-column")
		const welcomeBox = await welcome.boundingBox()
		const chatColumnBox = await chatColumn.boundingBox()
		const headingBox = await page.getByRole("heading", { name: "What should Fleet Prime Agent work on?", exact: true }).boundingBox()
		const formBox = await welcome.locator("form").boundingBox()
		expect(welcomeBox).not.toBeNull()
		expect(chatColumnBox).not.toBeNull()
		expect(headingBox).not.toBeNull()
		expect(formBox).not.toBeNull()
		if (welcomeBox && chatColumnBox && headingBox && formBox) {
			expect(Math.abs(welcomeBox.x + welcomeBox.width / 2 - (chatColumnBox.x + chatColumnBox.width / 2))).toBeLessThanOrEqual(2)
			expect(Math.abs(headingBox.x - formBox.x)).toBeLessThanOrEqual(2)
			expect(welcomeBox.x).toBeGreaterThanOrEqual(chatColumnBox.x - 1)
			expect(welcomeBox.x + welcomeBox.width).toBeLessThanOrEqual(chatColumnBox.x + chatColumnBox.width + 1)
		}
		expect(await welcome.evaluate((element) => getComputedStyle(element).textAlign)).toBe("left")

		let chatPostCount = 0
		page.on("request", (request) => {
			if (request.method() === "POST" && new URL(request.url()).pathname === "/api/chat") chatPostCount += 1
		})
		await page.getByRole("button", { name: "Explore codebase", exact: true }).click()
		await expect(prompt).toHaveValue(
			"Explore this codebase and explain its architecture, important modules, and main entry points.",
		)
		expect(chatPostCount).toBe(0)
	})

	test("empty welcome state uses one column on a narrow viewport", async ({ page }) => {
		await page.setViewportSize({ width: 700, height: 850 })
		await page.goto("/")

		await expect(page.getByRole("heading", { name: "What should Fleet Prime Agent work on?", exact: true })).toBeVisible({ timeout: 15_000 })
		const welcome = page.locator('section[aria-labelledby="fleet-welcome-title"]')
		const actions = welcome.locator('[aria-label="Suggested prompts"]')
		const chatColumn = page.getByTestId("chat-column")
		const actionButtons = actions.getByRole("button")
		await expect(actionButtons).toHaveCount(4)
		expect(
			await actions.evaluate((element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length),
		).toBe(1)

		const welcomeBox = await welcome.boundingBox()
		const chatColumnBox = await chatColumn.boundingBox()
		const formBox = await welcome.locator("form").boundingBox()
		expect(welcomeBox).not.toBeNull()
		expect(chatColumnBox).not.toBeNull()
		expect(formBox).not.toBeNull()
		if (welcomeBox && chatColumnBox && formBox) {
			expect(welcomeBox.x).toBeGreaterThanOrEqual(chatColumnBox.x - 1)
			expect(welcomeBox.x + welcomeBox.width).toBeLessThanOrEqual(chatColumnBox.x + chatColumnBox.width + 1)
			expect(Math.abs(welcomeBox.x - formBox.x)).toBeLessThanOrEqual(2)
		}
		expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
	})

	test("first empty-state submit switches to the normal docked composer", async ({ page }) => {
		let chatPostCount = 0
		let submittedOpenUI: boolean | undefined
		await page.route("**/api/chat**", async (route) => {
			const request = route.request()
			const pathname = new URL(request.url()).pathname
			if (pathname === "/api/chat/new" && request.method() === "POST") {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ session: { sessionId: "welcome-smoke-session" }, messages: [] }),
				})
				return
			}
			if (pathname === "/api/chat" && request.method() === "POST") {
				chatPostCount += 1
				submittedOpenUI = (request.postDataJSON() as { openUI?: boolean }).openUI
				await route.fulfill({
					status: 200,
					headers: { "content-type": "application/x-ndjson" },
					body: "",
				})
				return
			}
			await route.continue()
		})

		await page.setViewportSize({ width: 1400, height: 900 })
		await page.goto("/")
		const emptyPrompt = page.getByRole("textbox", { name: "Prompt" })
		await expect(page.getByRole("heading", { name: "What should Fleet Prime Agent work on?", exact: true })).toBeVisible({ timeout: 15_000 })
		await expect(emptyPrompt).toBeVisible({ timeout: 15_000 })
		await page.waitForLoadState("networkidle")
		await emptyPrompt.fill("Inspect the current implementation")
		await expect(emptyPrompt).toHaveValue("Inspect the current implementation")
		await expect(emptyPrompt).toBeEditable()
		const sendPrompt = page.getByRole("button", { name: "Send prompt" })
		await expect(sendPrompt).toBeEnabled({ timeout: 15_000 })
		await sendPrompt.click()

		await expect(page.getByRole("heading", { name: "What should Fleet Prime Agent work on?", exact: true })).toHaveCount(0)
		await expect(page.getByPlaceholder("Ask Prime to build, investigate, or change something…")).toHaveCount(0)
		const normalPrompt = page.getByPlaceholder("Send a message…")
		await expect(normalPrompt).toBeVisible()
		await expect(page.getByTestId("chat-column").getByText("Inspect the current implementation", { exact: true })).toBeVisible()
		await expect(page.getByRole("button", { name: "Add to prompt" })).toBeVisible()
		await expect(page.getByRole("button", { name: "Select mode" })).toBeVisible()
		await expect(page.getByRole("combobox", { name: "Select model and reasoning effort" })).toBeVisible()
		await expect(page.getByRole("button", { name: /Enable OpenUI|Disable OpenUI/ })).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Send prompt" })).toBeVisible()
		await expect.poll(() => chatPostCount).toBe(1)
		await expect.poll(() => submittedOpenUI).toBe(true)
	})

	test("structured tool traces keep terminal state and a capped activity rail", async ({ page }) => {
		const browserErrors: string[] = []
		page.on("console", (message) => {
			if (message.type() === "error") browserErrors.push(message.text())
		})
		page.on("pageerror", (error) => browserErrors.push(error.message))

		const ipythonStart = {
			type: "tool-IPython",
			toolCallId: "python-trace-1",
			state: "input-streaming",
			input: { code: "print('trace ok')" },
		}
		const ipythonUpdate = {
			...ipythonStart,
			result: { details: { stdout: "trace ok" } },
		}
		const ipythonEnd = {
			...ipythonStart,
			state: "output-available",
			output: {
				details: {
					stdout: "trace ok",
					stderr: "",
					durationMs: 22,
					kernelRestarted: false,
				},
			},
		}
		const terminalParts = Array.from({ length: 12 }, (_, index) => ({
			type: "tool-Bash",
			toolCallId: `bash-trace-${index}`,
			state: "output-available",
			input: { command: `echo trace-${index}` },
			output: { stdout: `trace-${index}` },
		}))
		const editPart = {
			type: "tool-Edit",
			toolCallId: "edit-trace-1",
			state: "output-available",
			input: { path: "src/trace.ts" },
			output: { diff: "@@\n-old\n+new" },
		}
		const citationPart = {
			type: "tool-WebSearch",
			toolCallId: "search-trace-1",
			state: "output-available",
			output: {
				results: [
					{ title: "Safe source", url: "https://example.com/docs" },
					{ title: "Unsafe source", url: "javascript:alert(1)" },
				],
			},
		}
		const terminalPartsWithRichDetails = [ipythonEnd, ...terminalParts, editPart, citationPart]

		await page.route("**/api/chat**", async (route) => {
			const request = route.request()
			const pathname = new URL(request.url()).pathname
			if (pathname === "/api/chat/new" && request.method() === "POST") {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ session: { sessionId: "trace-smoke-session" }, messages: [] }),
				})
				return
			}
			if (pathname !== "/api/chat" || request.method() !== "POST") {
				await route.continue()
				return
			}

			const messageId = "trace-run-a0"
			const stream = [
				{ type: "start", id: messageId, runId: "trace-run", sessionId: "trace-smoke-session" },
				{ type: "thinking", text: "Preparing trace", messageId },
				{ type: "tool", messageId, part: ipythonStart },
				{ type: "tool", messageId, part: ipythonUpdate },
				{ type: "tool", messageId, part: ipythonEnd },
				...terminalPartsWithRichDetails.map((part) => ({ type: "tool", messageId, part })),
				{
					type: "done",
					runId: "trace-run",
					sessionId: "trace-smoke-session",
					message: {
						id: messageId,
						role: "assistant",
						parts: [
							{ type: "text", text: "Trace complete" },
							{ type: "tool-Thinking", toolCallId: `${messageId}-thinking-0`, state: "output-available", input: { thought: "Preparing trace" }, output: "Preparing trace" },
							...terminalPartsWithRichDetails,
						],
					},
				},
			].map((event) => JSON.stringify(event)).join("\n") + "\n"

			await route.fulfill({
				status: 200,
				headers: { "content-type": "application/x-ndjson" },
				body: stream,
			})
		})

		await page.setViewportSize({ width: 1400, height: 900 })
		await page.goto("/")
		const prompt = page.getByRole("textbox", { name: "Prompt" })
		await expect(prompt).toBeVisible({ timeout: 15_000 })
		await page.waitForLoadState("networkidle")
		await prompt.fill("Run the trace fixture")
		await page.getByRole("button", { name: "Send prompt" }).click()

		await expect(page.getByText("Trace complete", { exact: true })).toBeVisible({ timeout: 15_000 })
		await expect(page.getByPlaceholder("Send a message…")).toBeVisible()
		await expect(page.locator('[data-state="running"]')).toHaveCount(0)
		await expect(page.locator('[data-state="success"]')).toHaveCount(14)

		const activity = page.locator('[data-content="mixed"]').first()
		await expect(activity).toHaveAttribute("data-state", "closed")
		await activity.getByRole("button").click()
		const activityList = activity.getByRole("list")
		await expect(activityList).toBeVisible()
		const activityViewport = activityList.locator("..")
		const viewportStyle = await activityViewport.getAttribute("style")
		expect(viewportStyle).toContain("height: 208px")

		const ipythonButton = page.getByRole("button", { name: /IPython/ }).first()
		await expect(ipythonButton).toHaveAttribute("aria-expanded", "false")
		await ipythonButton.click()
		await expect(page.getByText(/stdout/).first()).toBeVisible()
		expect(await page.getByRole("button", { name: /IPython/ }).count()).toBe(1)

		const sourcesButton = page.getByRole("button", { name: /Sources/ }).first()
		await sourcesButton.click()
		await expect(page.getByText("Safe source", { exact: true })).toBeVisible()
		await expect(page.getByText("Unsafe source", { exact: true })).toBeVisible()
		expect(await page.locator('a[href^="javascript:"]').count()).toBe(0)
		expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
		expect(browserErrors).toEqual([])
	})

	test("Codex-style sidebar preserves the project hierarchy and chrome", async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 })
		await page.goto("/")
		await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible({ timeout: 15_000 })

		const sidebar = page.getByRole("complementary", { name: "Fleet projects and sessions" })
		await expect(sidebar).toBeVisible()
		expect(await sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(280)
		await expect(sidebar.getByRole("button", { name: "Qredence Fleet", exact: true })).toBeVisible()
		await expect(sidebar.getByRole("button", { name: "New chat", exact: true })).toBeVisible()
		await expect(sidebar.getByText("Projects", { exact: true })).toBeVisible()
		await expect(sidebar.getByText("Recents", { exact: true })).toHaveCount(0)
		await expect(sidebar.getByRole("button", { name: "Open account menu" })).toContainText("Qredence")

		await expect(
			sidebar.getByRole("button", { name: "Search projects and sessions" }),
		).toBeVisible()
	})

	test("/api/workspace/tree responds", async ({ request }) => {
		const response = await request.get("/api/workspace/tree")
		expect(response.ok()).toBeTruthy()
		const body = (await response.json()) as {
			root?: string
			nodes?: Array<{ name: string; type: string }>
		}
		expect(typeof body.root).toBe("string")
		expect(Array.isArray(body.nodes)).toBe(true)
	})

	test("/api/workspace/file previews ARCHITECTURE.md", async ({ request }) => {
		// Default cwd is the git repo root (prime-agent/), not web/app.
		const response = await request.get(
			"/api/workspace/file?path=web/app/ARCHITECTURE.md",
		)
		expect(response.ok()).toBeTruthy()
		const body = (await response.json()) as {
			status?: string
			mediaType?: string
			content?: string
			name?: string
		}
		expect(body.status).toBe("ok")
		expect(body.mediaType).toBe("text/markdown")
		expect(body.name).toBe("ARCHITECTURE.md")
		expect(body.content).toMatch(/Prime-Agent Web Architecture/i)
	})

	test("BEUI chat preserves the desktop panel tabs and toggle behavior", async ({ page }) => {
		const browserErrors: string[] = []
		page.on("console", (message) => {
			if (message.type() === "error") browserErrors.push(message.text())
		})
		page.on("pageerror", (error) => browserErrors.push(error.message))
		await page.setViewportSize({ width: 1400, height: 900 })
		await page.goto("/")
		await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible({ timeout: 15_000 })
		await expect(page.locator("html")).toHaveAttribute("data-density", /.+/)
		const resources = page.getByRole("tab", { name: "Resources", exact: true })
		const workspace = page.getByRole("tab", { name: "Workspace", exact: true })
		const artifacts = page.getByRole("tab", { name: "Workspace artifacts", exact: true })
		await expect(resources).toBeVisible()
		await expect(workspace).toBeVisible()
		await expect(artifacts).toBeVisible()

		await resources.click()
		await expect(page.getByTestId("right-panel-inline-launcher")).toHaveAttribute("data-active-panel", "resources")
		await expect(page.getByTestId("pi-resources-canvas")).toBeVisible()
		await workspace.click()
		await expect(page.getByTestId("pi-workspace-canvas")).toBeVisible()
		await expect(page.getByTestId("pi-resources-canvas")).toHaveCount(0)
		await workspace.click()
		await expect(page.getByTestId("pi-workspace-canvas")).toHaveCount(0)

		await page.keyboard.press("Control+Shift+Digit3")
		await expect(page.getByTestId("pi-artifacts-canvas")).toBeVisible()
		await page.keyboard.press("Escape")
		await expect(page.getByTestId("pi-artifacts-canvas")).toHaveCount(0)
		expect(browserErrors).toEqual([])
	})

	test("Settings keeps the original sidebar and Prime configuration sections", async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 })
		const commandsResponse = page.waitForResponse(
			(response) => response.url().endsWith("/api/chat/commands") && response.request().method() === "GET",
		)
		await page.goto("/")
		await commandsResponse
		const prompt = page.getByRole("textbox", { name: "Prompt" })
		await expect(prompt).toBeVisible({ timeout: 15_000 })
		await prompt.fill("/settings")
		await prompt.press("Enter")

		const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
		await expect(dialog).toBeVisible()
		for (const label of ["Appearance", "Sandbox", "Providers", "LLM Models", "Skills", "Pi Harness", "Chat", "Keybindings", "Sessions"]) {
			await expect(dialog.getByRole("button", { name: label, exact: true })).toBeVisible()
		}

		await dialog.getByRole("button", { name: "Providers", exact: true }).click()
		await expect(dialog.getByRole("heading", { name: "Providers", exact: true })).toBeVisible()
		await dialog.getByRole("button", { name: "LLM Models", exact: true }).click()
		await expect(dialog.getByRole("heading", { name: "LLM Models", exact: true })).toBeVisible()
		await dialog.getByRole("button", { name: "Close", exact: true }).click()
		await expect(dialog).toHaveCount(0)
	})

	test("composer shows vertical slash and workspace reference menus", async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 })
		const commandsResponse = page.waitForResponse(
			(response) => response.url().endsWith("/api/chat/commands") && response.request().method() === "GET",
		)
		const workspaceResponse = page.waitForResponse(
			(response) => response.url().endsWith("/api/workspace/tree") && response.request().method() === "GET",
		)
		await page.goto("/")
		await commandsResponse
		await workspaceResponse
		await page.waitForLoadState("networkidle")
		const prompt = page.getByRole("textbox", { name: "Prompt" })
		await expect(prompt).toBeVisible({ timeout: 15_000 })

		await prompt.fill("/")
		const slashList = page.getByRole("listbox")
		await expect(slashList).toBeVisible()
		expect(await slashList.evaluate((element) => getComputedStyle(element).flexDirection)).toBe("column")
		expect(await slashList.getByRole("option").count()).toBeGreaterThan(0)

		await prompt.fill("@")
		const workspaceList = page.getByRole("listbox")
		await expect(workspaceList).toBeVisible()
		await expect(workspaceList.getByRole("option").first()).toBeVisible()
		const firstWorkspacePath = (await workspaceList.getByRole("option").first().innerText()).split("\n", 1)[0]?.trim()
		expect(firstWorkspacePath).toBeTruthy()
		await prompt.press("Enter")
		// The trigger token is replaced by a removable chip; the raw path is not
		// duplicated into the free-form prompt text.
		await expect(prompt).toHaveValue("")
		await expect(page.getByRole("button", { name: `Remove workspace reference ${firstWorkspacePath}` })).toBeVisible()
	})

	test("narrow layout opens an accessible panel dialog", async ({ page }) => {
		await page.setViewportSize({ width: 700, height: 850 })
		await page.goto("/")
		await expect(page.getByRole("textbox", { name: "Prompt" })).toBeVisible({ timeout: 15_000 })
		await expect(page.locator("html")).toHaveAttribute("data-density", /.+/)
		await page.getByRole("button", { name: "Toggle conversations" }).click()
		const sidebarDialog = page.getByRole("dialog", { name: "Fleet projects and sessions" })
		await expect(sidebarDialog).toBeVisible()
		const sidebarBox = await sidebarDialog.boundingBox()
		expect(sidebarBox?.width).toBeLessThanOrEqual(700 * 0.88)
		await expect(sidebarDialog.getByRole("button", { name: "Open account menu" })).toContainText("Qredence")
		await page.keyboard.press("Escape")
		await expect(sidebarDialog).toHaveCount(0)
		await page.getByRole("tab", { name: "Workspace", exact: true }).click()
		const dialog = page.getByRole("dialog", { name: "Workspace", exact: true })
		await expect(dialog).toBeVisible()
		await dialog.getByRole("button", { name: "Close panel" }).click()
		await expect(dialog).toHaveCount(0)
	})

	test("provider-backed Prime turn streams through the BEUI composer", async ({ page }) => {
		test.skip(process.env.PRIME_REAL_ACCEPTANCE !== "1", "Run explicitly when local Prime provider credentials are available")
		const browserErrors: string[] = []
		page.on("console", (message) => {
			if (message.type() === "error") browserErrors.push(message.text())
		})
		page.on("pageerror", (error) => browserErrors.push(error.message))
		await page.goto("/")
		await expect(page.locator("html")).toHaveAttribute("data-density", /.+/)
		const newSessionResponse = page.waitForResponse(
			(response) => response.url().endsWith("/api/chat/new") && response.request().method() === "POST",
		)
		await page.getByRole("button", { name: "New chat", exact: true }).click()
		const sessionId = ((await (await newSessionResponse).json()) as { session: { sessionId: string } }).session.sessionId
		const prompt = page.getByRole("textbox", { name: "Prompt" })
		await prompt.fill("Reply with exactly fleet-prime-live-ok and no other text.")
		await prompt.press("Enter")
		await expect(page.getByText("fleet-prime-live-ok", { exact: true })).toBeVisible({ timeout: 120_000 })
		expect(browserErrors).toEqual([])
		const deleteResponse = await page.request.delete("/api/chat/sessions", { data: { sessionId } })
		expect(deleteResponse.ok()).toBe(true)
	})
})
