import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown, MarkdownFrame } from "@/components/chat/markdown/markdown";
import { HighlightedMarkdown } from "@/components/chat/markdown/markdown-code";
import { SizeProvider } from "@/lib/fluid/size-context";

describe("Fluid markdown typography", () => {
	it("follows density changes without replacing rendered content", () => {
		const content = (
			<p>
				Reply with an inline <code>value</code>.
			</p>
		);
		const { container, rerender } = render(
			<SizeProvider size="default">
				<MarkdownFrame>{content}</MarkdownFrame>
			</SizeProvider>,
		);
		const paragraph = container.querySelector("p");
		expect(container.querySelector(".typeset")).toBeTruthy();
		expect(container.querySelector(".typeset-compact")).toBeNull();

		rerender(
			<SizeProvider size="compact">
				<MarkdownFrame>{content}</MarkdownFrame>
			</SizeProvider>,
		);
		expect(container.querySelector(".typeset.typeset-compact")).toBeTruthy();
		expect(container.querySelector("p")).toBe(paragraph);

		rerender(
			<SizeProvider size="default">
				<MarkdownFrame>{content}</MarkdownFrame>
			</SizeProvider>,
		);
		expect(container.querySelector(".typeset-compact")).toBeNull();
	});

	it("renders prose semantics and wide tables in a default frame without a provider", () => {
		const { container } = render(
			<Markdown
				content={[
					"# Display",
					"## Title",
					"### Subtitle",
					"#### Fourth",
					"##### Fifth",
					"###### Sixth",
					"Paragraph with `inline code`.",
					"- Parent\n  - Nested",
					"- [ ] Pending\n- [x] Done",
					"| Column | Value |\n| --- | --- |\n| Wide table | 42 |",
				].join("\n\n")}
				isStreaming
			/>,
		);
		expect(container.querySelector(".typeset-compact")).toBeNull();
		expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(6);
		expect(container.querySelector("p code")?.textContent).toBe("inline code");
		expect(container.querySelector("ul ul")).toBeTruthy();
		expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
		expect(container.querySelector(".typeset-scroll > table")).toBeTruthy();
	});
});

describe("assistant markdown code blocks", () => {
	it("renders a shadcn code surface with copy and download controls while streaming", () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
		const { container } = render(<Markdown content={"```ts\nconst answer = 42;\n```"} isStreaming />);

		expect(screen.getByText("const answer = 42;")).toBeTruthy();
		expect(container.querySelector('[data-slot="code-block"]')).toBeTruthy();
		expect(container.querySelector('[data-slot="code-block"].not-typeset')).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
		expect(writeText).toHaveBeenCalledWith("const answer = 42;\n");
		expect(screen.getByRole("button", { name: "Download code" })).toBeTruthy();
	});

	it("respects disabled code controls", () => {
		render(<Markdown content={"```ts\nconst answer = 42;\n```"} isStreaming codeControls={false} />);

		expect(screen.queryByRole("button", { name: "Copy code" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Download code" })).toBeNull();
		expect(screen.getByText("const answer = 42;")).toBeTruthy();
	});

	it.each(["python", "py"])("preserves the %s fence language", (language) => {
		const { container } = render(<Markdown content={"```" + language + "\nprint('hello')\n```"} isStreaming />);

		expect(container.querySelector('[data-slot="code-block-title"]')?.textContent).toBe("python");
	});
	it.each([
		["PYTHON", "py"],
		["py", "py"],
		["markdown", "md"],
		["text", "txt"],
		["tsx", "tsx"],
	])("downloads %s code with the %s extension", (language, extension) => {
		const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:code");
		const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			expect(this.download).toBe(`code.${extension}`);
		});
		try {
			render(<Markdown content={`\`\`\`${language}\nexample\n\`\`\``} isStreaming />);
			fireEvent.click(screen.getByRole("button", { name: "Download code" }));
			expect(click).toHaveBeenCalledOnce();
		} finally {
			createUrl.mockRestore();
			click.mockRestore();
		}
	});

	it.each([
		["python", "py"],
		["markdown", "md"],
		["text", "txt"],
	])("downloads %s code with the .%s extension", (language, extension) => {
		const originalCreateObjectURL = URL.createObjectURL;
		URL.createObjectURL = vi.fn(() => "blob:test");
		let downloadName = "";
		const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloadName = this.download;
		});
		try {
			render(<Markdown content={`\`\`\`${language}\nexample\n\`\`\``} isStreaming />);
			fireEvent.click(screen.getByRole("button", { name: "Download code" }));
			expect(downloadName).toBe(`code.${extension}`);
		} finally {
			click.mockRestore();
			URL.createObjectURL = originalCreateObjectURL;
		}
	});

	it("keeps Streamdown syntax highlighting inside the CodeBlock surface", async () => {
		const { container } = render(<HighlightedMarkdown content={"```ts\nconst answer = 42;\n```"} />);

		await waitFor(() => expect(container.querySelector('[data-slot="code-block"]')).toBeTruthy());
		await waitFor(() => expect(container.querySelector('[data-slot="code-block-content"] span')).toBeTruthy());
		expect(container.querySelectorAll("pre")).toHaveLength(1);
		expect(container.querySelectorAll("code")).toHaveLength(1);
		expect(container.querySelector('[data-streamdown="code-block"]')).toBeNull();
		expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
	});
});
