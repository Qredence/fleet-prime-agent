import { fireEvent, render, waitFor } from "@testing-library/react"
import type {
	WorkspaceFileResponse,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WorkspacePanelContent } from "@prime-agent/web-design/components/fleet-pi/pi/workspace-panel"
import type { WorkspacePanelContentProps } from "@prime-agent/web-design/components/fleet-pi/pi/workspace-panel"

const workspace: WorkspaceTreeResponse = {
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
}

function fileResponse(path: string): WorkspaceFileResponse {
	return {
		path,
		name: path.split("/").at(-1) ?? path,
		content: "# Preview\n\nPreview body",
		mediaType: "text/markdown",
		status: "ok",
	}
}

function renderPanel(overrides: Partial<WorkspacePanelContentProps> = {}) {
	const loadWorkspaceFile =
		overrides.loadWorkspaceFile ?? vi.fn(async (path: string) => fileResponse(path))

	return {
		loadWorkspaceFile,
		...render(
			<WorkspacePanelContent
				error={null}
				loading={false}
				workspace={workspace}
				{...overrides}
				loadWorkspaceFile={loadWorkspaceFile}
			/>,
		),
	}
}

beforeEach(() => {
	window.localStorage.clear()
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}),
	})
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	})
})

describe("WorkspacePanelContent file tree", () => {
	it("renders a semantic nested tree with collapsed folders", () => {
		const { getByRole, queryByRole } = renderPanel()

		expect(getByRole("tree", { name: "Workspace files" })).toBeTruthy()
		const docs = getByRole("treeitem", { name: "docs" })
		expect(docs.getAttribute("aria-level")).toBe("1")
		expect(docs.getAttribute("aria-expanded")).toBe("false")
		expect(queryByRole("treeitem", { name: "README.md" })).toBeNull()
		expect(getByRole("treeitem", { name: "notes.md" })).toBeTruthy()
	})

	it("expands folders without selecting them", () => {
		const onSelectedPathChange = vi.fn()
		const { getByRole, queryByRole } = renderPanel({
			onSelectedPathChange,
			selectedPath: null,
		})
		const docs = getByRole("treeitem", { name: "docs" })

		fireEvent.click(docs)

		expect(docs.getAttribute("aria-expanded")).toBe("true")
		expect(docs.getAttribute("aria-selected")).toBe("false")
		expect(onSelectedPathChange).not.toHaveBeenCalled()
		expect(queryByRole("treeitem", { name: "README.md" })).toBeTruthy()

		const guides = getByRole("treeitem", { name: "guides" })
		fireEvent.click(guides)

		expect(guides.getAttribute("aria-expanded")).toBe("true")
		expect(guides.getAttribute("aria-selected")).toBe("false")
		expect(queryByRole("treeitem", { name: "intro.md" })).toBeTruthy()
		expect(onSelectedPathChange).not.toHaveBeenCalled()

		fireEvent.click(docs)
		expect(docs.getAttribute("aria-expanded")).toBe("false")
		expect(onSelectedPathChange).not.toHaveBeenCalled()
	})

	it("does not make folders without loaded children expandable", () => {
		const workspaceWithCappedFolder = {
			...workspace,
			nodes: [
				...workspace.nodes,
				{
					name: "capped",
					path: "deep/capped",
					type: "directory" as const,
				},
			],
		}
		const { getByRole } = renderPanel({ workspace: workspaceWithCappedFolder })
		const capped = getByRole("treeitem", { name: "capped" })

		expect(capped.getAttribute("aria-expanded")).toBeNull()
		fireEvent.click(capped)
		fireEvent.keyDown(capped, { key: "Enter" })
		expect(capped.getAttribute("aria-expanded")).toBeNull()
	})

	it("selects files and renders their Markdown preview", async () => {
		const loadWorkspaceFile = vi.fn(async (path: string) => fileResponse(path))
		const { getByRole, getByTestId, getByText } = renderPanel({ loadWorkspaceFile })

		fireEvent.click(getByRole("treeitem", { name: "docs" }))
		const readme = getByRole("treeitem", { name: "README.md" })
		fireEvent.click(readme)

		await waitFor(() => expect(loadWorkspaceFile).toHaveBeenCalledWith("docs/README.md"))
		await waitFor(() => expect(getByText("Preview body", { exact: true })).toBeTruthy())
		expect(readme.getAttribute("aria-selected")).toBe("true")
		expect(getByTestId("workspace-preview").textContent).toContain("README.md")
	})

	it("supports tree keyboard navigation and file activation", async () => {
		const loadWorkspaceFile = vi.fn(async (path: string) => fileResponse(path))
		const { getByRole, queryByRole } = renderPanel({ loadWorkspaceFile })
		const docs = getByRole("treeitem", { name: "docs" })
		docs.focus()

		fireEvent.keyDown(docs, { key: "ArrowRight" })
		const readme = getByRole("treeitem", { name: "README.md" })
		expect(docs.getAttribute("aria-expanded")).toBe("true")

		fireEvent.keyDown(docs, { key: "ArrowDown" })
		expect(document.activeElement).toBe(readme)
		fireEvent.keyDown(readme, { key: "ArrowUp" })
		expect(document.activeElement).toBe(docs)
		fireEvent.keyDown(docs, { key: "ArrowRight" })
		expect(document.activeElement).toBe(readme)
		fireEvent.keyDown(readme, { key: "ArrowLeft" })
		expect(document.activeElement).toBe(docs)

		fireEvent.keyDown(docs, { key: " " })
		expect(docs.getAttribute("aria-expanded")).toBe("false")
		expect(queryByRole("treeitem", { name: "README.md" })).toBeNull()

		fireEvent.keyDown(docs, { key: "ArrowRight" })
		fireEvent.keyDown(docs, { key: "ArrowRight" })
		const reopenedReadme = getByRole("treeitem", { name: "README.md" })
		expect(document.activeElement).toBe(reopenedReadme)
		fireEvent.keyDown(reopenedReadme, { key: "Enter" })

		await waitFor(() => expect(loadWorkspaceFile).toHaveBeenCalledWith("docs/README.md"))
	})

	it("renders scoped artifact trees without leaking sibling paths", () => {
		const { getByRole, queryByRole } = renderPanel({
			scopeLabel: "artifacts",
			scopePath: "artifacts",
		})

		expect(getByRole("tree", { name: "Files in artifacts" })).toBeTruthy()
		expect(getByRole("treeitem", { name: "trace.md" })).toBeTruthy()
		expect(queryByRole("treeitem", { name: "docs" })).toBeNull()
	})

	it("preserves workspace error, loading, and empty states", () => {
		const errorView = renderPanel({ error: new Error("read failed") })
		expect(errorView.getByText("Unable to load workspace")).toBeTruthy()
		expect(errorView.getByText("read failed")).toBeTruthy()
		errorView.unmount()

		const loadingView = renderPanel({ loading: true, workspace: null })
		expect(loadingView.container.querySelector('[data-slot="skeleton"]')).toBeTruthy()
		loadingView.unmount()

		const emptyView = renderPanel({ workspace: null })
		expect(emptyView.getByText("Workspace unavailable")).toBeTruthy()
	})
})
