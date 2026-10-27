import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "@/components/chat/markdown/markdown";
import { HighlightedMarkdown } from "@/components/chat/markdown/markdown-code";

describe("assistant markdown code blocks", () => {
	it("renders a shadcn code surface with copy and download controls while streaming", () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
		const { container } = render(<Markdown content={"```ts\nconst answer = 42;\n```"} isStreaming />);

		expect(screen.getByText("const answer = 42;")).toBeTruthy();
		expect(container.querySelector('[data-slot="code-block"]')).toBeTruthy();
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
