const SECRET_VALUE_PATTERNS = [
	/\bsk-[A-Za-z0-9._-]{8,}\b/g,
	/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{8,}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
	/\bAIza[A-Za-z0-9_-]{20,}\b/g,
];

const NAMED_SECRET_PATTERN =
	/\b(api[ _-]?key|access[ _-]?token|auth[ _-]?token|bearer|password|secret)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

/** Removes credential-shaped values before a transcript-derived label reaches browser chrome. */
export function redactSessionLabelSecrets(label: string): string {
	let redacted = label.replace(
		NAMED_SECRET_PATTERN,
		(_match, name: string, separator: string) => `${name}${separator} [redacted]`,
	);
	for (const pattern of SECRET_VALUE_PATTERNS) {
		redacted = redacted.replace(pattern, "[redacted]");
	}
	return redacted;
}
