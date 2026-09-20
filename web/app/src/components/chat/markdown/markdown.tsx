import { Fragment, isValidElement, lazy, Suspense, useMemo } from "react";
import type { Components } from "streamdown";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

const LazyHighlightedMarkdown = lazy(() =>
	import("@/components/chat/markdown/markdown-code").then(({ HighlightedMarkdown }) => ({
		default: HighlightedMarkdown,
	})),
);

export function fixNumberedListBreaks(text: string): string {
	return text.replace(/^(\d+)\.\s*\n+\s*\n*/gm, "$1. ");
}

const CODE_FENCE_LANGS = new Set([
	"bash",
	"diff",
	"html",
	"js",
	"json",
	"jsx",
	"md",
	"markdown",
	"sh",
	"shell",
	"text",
	"ts",
	"tsx",
	"yml",
	"yaml",
]);

export function normalizeCodeFenceLanguages(text: string): string {
	return text.replace(/```([^\n]*)/g, (_match, langRaw) => {
		const lang = String(langRaw || "")
			.trim()
			.toLowerCase();
		if (!lang) return "```";
		const normalized = lang.split(/\s+/)[0];
		return CODE_FENCE_LANGS.has(normalized) ? `\`\`\`${normalized}` : "```text";
	});
}

export type MarkdownProps = {
	content: string;
	className?: string;
	textContrast?: "normal" | "high";
	codeControls?: boolean;
	isStreaming?: boolean;
};

const SAFE_HREF_PATTERN = /^(https?:|mailto:)/i;

/**
 * Determines whether a rendered Markdown element contains a block-level image or code element.
 *
 * @param value - The value to inspect recursively.
 * @returns `true` if the value contains a block-level image or code element, `false` otherwise.
 */
function containsBlockMarkdownChild(value: unknown, imageIsSoleChild: boolean): boolean {
	if (!isValidElement(value)) return false;

	const props = value.props;
	if (typeof props !== "object" || props === null) return false;

	const node = "node" in props ? props.node : undefined;
	const tagName = typeof node === "object" && node !== null && "tagName" in node ? node.tagName : undefined;
	if (tagName === "img") return imageIsSoleChild;
	if (tagName === "code" && "data-block" in props) return true;

	return "children" in props && containsBlockMarkdownChild(props.children, imageIsSoleChild);
}

export const markdownComponents: Components = {
	// Headings / body / lists: Typeset owns size, weight, and flow.
	h1: ({ children, ...props }) => <h1 {...props}>{children}</h1>,
	h2: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
	h3: ({ children, ...props }) => <h3 {...props}>{children}</h3>,
	h4: ({ children, ...props }) => <h4 {...props}>{children}</h4>,
	p: ({ children, node, ...props }) => {
		const child = (Array.isArray(children) ? children : [children]).filter((value) => value != null && value !== "");

		if (child.some((value) => containsBlockMarkdownChild(value, child.length === 1))) {
			return <Fragment>{children}</Fragment>;
		}

		return <p {...props}>{children}</p>;
	},
	ul: ({ children, ...props }) => <ul {...props}>{children}</ul>,
	ol: ({ children, ...props }) => <ol {...props}>{children}</ol>,
	li: ({ children, ...props }) => <li {...props}>{children}</li>,
	strong: ({ children, ...props }) => <strong {...props}>{children}</strong>,
	a: ({ href, children, ...props }) => {
		if (typeof href !== "string" || !SAFE_HREF_PATTERN.test(href)) {
			return <span>{children}</span>;
		}
		const isExternal = href.startsWith("http");
		return (
			<a
				{...props}
				href={href}
				target={isExternal ? "_blank" : undefined}
				rel={isExternal ? "noopener noreferrer" : undefined}
			>
				{children}
			</a>
		);
	},
	blockquote: ({ children, ...props }) => <blockquote {...props}>{children}</blockquote>,
	hr: ({ ...props }) => <hr {...props} />,
	table: ({ children, ...props }) => (
		<div className="typeset-scroll">
			<table {...props}>{children}</table>
		</div>
	),
	th: ({ children, ...props }) => <th {...props}>{children}</th>,
	td: ({ children, ...props }) => <td {...props}>{children}</td>,
};

/** Wraps rendered Markdown in the Typeset chat preset and merges optional container classes. */
export function MarkdownFrame({ children, className }: { children: React.ReactNode; className?: string }) {
	return <div className={cn("typeset typeset-chat", "overflow-hidden wrap-break-word", className)}>{children}</div>;
}

/**
 * Renders markdown content without syntax highlighting. Normalizes code fence
 * languages and fixes numbered list breaks, with memoization to optimize
 * performance during streaming.
 *
 * @param content - The markdown content to render
 * @param className - Optional CSS class for styling the markdown container
 * @param codeControls - Optional controls for code block interactions
 * @returns Rendered plain markdown without syntax highlighting
 */
function PlainMarkdown({ content, className, codeControls }: MarkdownProps) {
	// Regex preprocessing runs per render (including per streamed token), so
	// memoize on content — the transforms are pure functions of it.
	const safeContent = useMemo(() => normalizeCodeFenceLanguages(fixNumberedListBreaks(content)), [content]);

	return (
		<MarkdownFrame className={className}>
			<Streamdown components={markdownComponents} controls={{ code: codeControls }}>
				{safeContent}
			</Streamdown>
		</MarkdownFrame>
	);
}

export function Markdown(props: MarkdownProps) {
	if (props.isStreaming || !props.content.includes("```")) return <PlainMarkdown {...props} />;

	return (
		<Suspense fallback={<PlainMarkdown {...props} />}>
			<LazyHighlightedMarkdown {...props} />
		</Suspense>
	);
}
