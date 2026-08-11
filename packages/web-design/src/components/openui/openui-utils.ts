export type OpenUIContentSegment = {
	content: string;
	id: string;
	type: "markdown" | "openui";
};

type OpenUIContentSegmentType = OpenUIContentSegment["type"];

const OPENUI_FENCE_PATTERN = /```(?:openui|openui-lang)(?:[ \t]*\r?\n|[ \t]+)([\s\S]*?)```/gi;

function appendSegment(
	segments: Array<OpenUIContentSegment>,
	ordinals: Record<OpenUIContentSegmentType, number>,
	type: OpenUIContentSegmentType,
	content: string,
) {
	const ordinal = ordinals[type];
	ordinals[type] += 1;
	segments.push({ content, id: `${type}-${ordinal}`, type });
}

export function stripOpenUIWrapper(content: string) {
	const cleaned = content.trim();
	const fences = Array.from(cleaned.matchAll(OPENUI_FENCE_PATTERN));
	const onlyFence = fences[0];

	if (fences.length === 1 && onlyFence?.index === 0 && onlyFence[0].length === cleaned.length) {
		return onlyFence[1].trim();
	}

	return cleaned;
}

export function isOpenUIProgram(content: string) {
	return stripOpenUIWrapper(content).startsWith("root =");
}

export function segmentOpenUIContent(content: string): Array<OpenUIContentSegment> {
	const segments: Array<OpenUIContentSegment> = [];
	const ordinals = { markdown: 0, openui: 0 };
	const stripped = stripOpenUIWrapper(content);
	if (stripped.startsWith("root =")) {
		appendSegment(segments, ordinals, "openui", stripped);
		return segments;
	}

	let lastIndex = 0;

	for (const match of content.matchAll(OPENUI_FENCE_PATTERN)) {
		const index = match.index;
		const markdown = content.slice(lastIndex, index);
		if (markdown.trim()) {
			appendSegment(segments, ordinals, "markdown", markdown);
		}

		const openUI = match[1].trim();
		const isOpenUI = isOpenUIProgram(openUI);
		appendSegment(segments, ordinals, isOpenUI ? "openui" : "markdown", isOpenUI ? openUI : match[0]);

		lastIndex = index + match[0].length;
	}

	const trailingMarkdown = content.slice(lastIndex);
	if (trailingMarkdown.trim()) {
		appendSegment(segments, ordinals, "markdown", trailingMarkdown);
	}

	if (segments.length > 0) return segments;

	appendSegment(segments, ordinals, "markdown", content);
	return segments;
}
