"use client";

import { type CSSProperties, useEffect, useState } from "react";
import type { Highlighter } from "shiki";

export type AgentCodeLanguage = "bash" | "diff" | "json" | "python" | "text" | "tsx" | "typescript";

export interface AgentCodeToken {
	content: string;
	offset: number;
	light?: string;
	dark?: string;
}

export type AgentCodeTokenLines = AgentCodeToken[][];

export interface AgentCodeLineProps {
	code: string;
	tokens?: AgentCodeToken[];
	suffix?: string;
	className?: string;
}

const LIGHT_THEME = "github-light-high-contrast";
const DARK_THEME = "github-dark-high-contrast";
let agentCodeHighlighter: Promise<Highlighter> | null = null;
const tokenCache = new Map<string, AgentCodeTokenLines>();
const MAX_TOKEN_CACHE_SIZE = 500;

function setCachedTokens(key: string, lines: AgentCodeTokenLines) {
	if (tokenCache.size >= MAX_TOKEN_CACHE_SIZE) {
		const firstKey = tokenCache.keys().next().value;
		if (firstKey !== undefined) tokenCache.delete(firstKey);
	}
	tokenCache.set(key, lines);
}
const loadShiki = () => import("shiki");

function getAgentCodeHighlighter() {
	if (!agentCodeHighlighter) {
		agentCodeHighlighter = loadShiki().then(({ createHighlighter }) =>
			createHighlighter({
				themes: [LIGHT_THEME, DARK_THEME],
				langs: ["bash", "diff", "json", "python", "tsx", "typescript"],
			}),
		);
	}
	return agentCodeHighlighter;
}

function tokenCacheKey(code: string, language: AgentCodeLanguage) {
	return `${language}\u0000${code}`;
}

export function useAgentCodeTokens(code: string, language: AgentCodeLanguage) {
	const key = tokenCacheKey(code, language);
	const cached = tokenCache.get(key);
	const [result, setResult] = useState<{
		key: string;
		code: string;
		language: AgentCodeLanguage;
		lines: AgentCodeTokenLines;
	} | null>(cached ? { key, code, language, lines: cached } : null);

	useEffect(() => {
		const current = tokenCache.get(key);
		if (current) {
			setResult({ key, code, language, lines: current });
			return;
		}

		let cancelled = false;
		getAgentCodeHighlighter().then((highlighter) => {
			if (cancelled) return;
			const lines = highlighter
				.codeToTokensWithThemes(code, {
					lang: language,
					themes: {
						light: LIGHT_THEME,
						dark: DARK_THEME,
					},
				})
				.map((line) =>
					line.map((token) => ({
						content: token.content,
						offset: token.offset,
						light: token.variants.light?.color,
						dark: token.variants.dark?.color,
					})),
				);
			setCachedTokens(key, lines);
			setResult({ key, code, language, lines });
		});
		return () => {
			cancelled = true;
		};
	}, [code, key, language]);

	if (result?.key === key) return result.lines;
	if (result?.language === language && code.startsWith(result.code)) {
		return result.lines;
	}
	return null;
}

export function AgentCodeLine({ code, tokens, suffix, className }: AgentCodeLineProps) {
	return (
		<span className={className}>
			{tokens
				? tokens.map((token) => (
						<span
							key={`${token.offset}-${token.content}`}
							style={
								{
									"--agent-code-light": token.light ?? "currentColor",
									"--agent-code-dark": token.dark ?? token.light ?? "currentColor",
								} as CSSProperties
							}
							className="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]"
						>
							{token.content}
						</span>
					))
				: code}
			{suffix}
		</span>
	);
}
