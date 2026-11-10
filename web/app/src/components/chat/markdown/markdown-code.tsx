import { createCodePlugin } from "@streamdown/code";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { BundledLanguage } from "shiki";
import { Streamdown } from "streamdown";
import type { MarkdownCodeContentProps, MarkdownProps } from "@/components/chat/markdown/markdown";
import {
	createMarkdownComponents,
	fixNumberedListBreaks,
	MarkdownFrame,
	normalizeCodeFenceLanguages,
} from "@/components/chat/markdown/markdown";

const code = createCodePlugin({
	themes: ["github-light", "github-dark"],
});

function HighlightedCodeContentInner({
	highlightOptions,
	fallbackSource,
}: {
	highlightOptions: Parameters<typeof code.highlight>[0];
	fallbackSource: string;
}) {
	const syncHighlighted = useMemo(() => code.highlight(highlightOptions), [highlightOptions]);
	const [asyncHighlighted, setAsyncHighlighted] = useState<ReturnType<typeof code.highlight> | null>(null);

	useEffect(() => {
		let active = true;
		code.highlight(highlightOptions, (next) => {
			if (active) setAsyncHighlighted(next);
		});
		return () => {
			active = false;
		};
	}, [highlightOptions]);

	const highlighted = asyncHighlighted ?? syncHighlighted;

	if (!highlighted) return <>{fallbackSource}</>;
	return (
		<>
			{highlighted.tokens.map((line, lineIndex) => (
				<span className="block" key={lineIndex}>
					{line.map((token) => (
						<span
							key={`${token.offset}-${token.content}`}
							style={token.htmlStyle as CSSProperties | undefined}
							{...token.htmlAttrs}
						>
							{token.content}
						</span>
					))}
					{lineIndex < highlighted.tokens.length - 1 ? "\n" : null}
				</span>
			))}
		</>
	);
}

function HighlightedCodeContent({ code: source, language }: MarkdownCodeContentProps) {
	const languageToUse = useMemo<BundledLanguage | undefined>(
		() => code.getSupportedLanguages().find((candidate) => candidate === language),
		[language],
	);
	if (!languageToUse) return <>{source}</>;

	return (
		<HighlightedCodeContentInner
			key={`${languageToUse}:${source}`}
			highlightOptions={{
				code: source,
				language: languageToUse,
				themes: code.getThemes(),
			}}
			fallbackSource={source}
		/>
	);
}

export function HighlightedMarkdown({ content, className, codeControls }: MarkdownProps) {
	const safeContent = normalizeCodeFenceLanguages(fixNumberedListBreaks(content));
	const components = createMarkdownComponents(codeControls !== false, HighlightedCodeContent);

	return (
		<MarkdownFrame className={className}>
			<Streamdown components={components} controls={{ code: false }} plugins={{ code }}>
				{safeContent}
			</Streamdown>
		</MarkdownFrame>
	);
}
