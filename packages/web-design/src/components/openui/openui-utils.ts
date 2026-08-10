export type OpenUIContentSegment = { content: string; type: "markdown" } | { content: string; type: "openui" };

const OPENUI_FENCE_PATTERN = /```(?:openui|openui-lang)(?:[ \t]*\r?\n|[ \t]+)([\s\S]*?)```/gi;
const OPENUI_WRAPPER_PATTERN = /^```(?:openui|openui-lang)(?:[ \t]*\r?\n|[ \t]+)([\s\S]*?)```$/i;

export function stripOpenUIWrapper(content: string) {
	const cleaned = content.trim();
	const openUIFenceMatch = cleaned.match(OPENUI_WRAPPER_PATTERN);

	if (openUIFenceMatch) {
		return openUIFenceMatch[1].trim();
	}

	return cleaned;
}

export function isOpenUIProgram(content: string) {
	return stripOpenUIWrapper(content).startsWith("root =");
}

export function segmentOpenUIContent(content: string): Array<OpenUIContentSegment> {
	const stripped = stripOpenUIWrapper(content);
	if (stripped.startsWith("root =")) {
		return [{ type: "openui", content: stripped }];
	}

	const segments: Array<OpenUIContentSegment> = [];
	let lastIndex = 0;

	for (const match of content.matchAll(OPENUI_FENCE_PATTERN)) {
		const index = match.index;
		const markdown = content.slice(lastIndex, index);
		if (markdown.trim()) {
			segments.push({ type: "markdown", content: markdown });
		}

		const openUI = match[1].trim();
		segments.push(
			isOpenUIProgram(openUI) ? { type: "openui", content: openUI } : { type: "markdown", content: match[0] },
		);

		lastIndex = index + match[0].length;
	}

	const trailingMarkdown = content.slice(lastIndex);
	if (trailingMarkdown.trim()) {
		segments.push({ type: "markdown", content: trailingMarkdown });
	}

	return segments.length > 0 ? segments : [{ type: "markdown", content }];
}
