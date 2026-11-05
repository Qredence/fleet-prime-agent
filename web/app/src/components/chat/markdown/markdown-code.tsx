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

export function HighlightedCodeContent({ code: source, language }: MarkdownCodeContentProps) {
	const languageToUse = useMemo<BundledLanguage | undefined>(
		() => code.getSupportedLanguages().find((candidate) => candidate === language),
		[language],
	);
	const [highlighted, setHighlighted] = useState<ReturnType<typeof code.highlight>>(null);

	useEffect(() => {
		let active = true;
		if (!languageToUse) {
			setHighlighted(null);
			return () => {
				active = false;
			};
		}
		const options: Parameters<typeof code.highlight>[0] = {
			code: source,
			language: languageToUse,
			themes: code.getThemes(),
		};
		const result = code.highlight(options, (next) => {
			if (active) setHighlighted(next);
		});
		setHighlighted(result);
		return () => {
			active = false;
		};
	}, [languageToUse, source]);

	if (!highlighted) return <>{source}</>;
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
