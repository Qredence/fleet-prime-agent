/** Parsed skill block from a user message. */
export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage: string | undefined;
}

/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
	const openMatch = /^<skill name="([^"]+)" location="([^"]+)">\n/.exec(text);
	if (!openMatch) {
		return null;
	}
	const contentStart = openMatch[0].length;
	const closeIndex = text.indexOf("</skill>", contentStart);
	if (closeIndex < contentStart || text[closeIndex - 1] !== "\n") {
		return null;
	}
	const content = text.slice(contentStart, closeIndex - 1);
	const rest = text.slice(closeIndex + "</skill>".length);
	let userMessage: string | undefined;
	if (rest.length > 0) {
		if (!rest.startsWith("\n\n")) {
			return null;
		}
		const message = rest.slice(2);
		if (message.length === 0) {
			return null;
		}
		userMessage = message;
	}
	return {
		name: openMatch[1],
		location: openMatch[2],
		content,
		userMessage: userMessage?.trim() || undefined,
	};
}
