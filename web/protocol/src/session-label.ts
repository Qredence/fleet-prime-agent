const SECRET_VALUE_PATTERNS = [
	/\bsk-[A-Za-z0-9._-]{8,}\b/g,
	/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{8,}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
	/\bAIza[A-Za-z0-9_-]{20,}\b/g,
];

const NAMED_SECRET_PATTERN =
	/\b(api[ _-]?key|access[ _-]?token|auth[ _-]?token|bearer|password|secret)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

/** Upstream SessionManager placeholder when a listing counted no user turns. */
export const EMPTY_SESSION_FIRST_MESSAGE = "(no messages)";

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

/** Returns a secret-redacted label, or undefined when the value is empty/placeholder. */
export function meaningfulSessionLabel(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed || trimmed === EMPTY_SESSION_FIRST_MESSAGE) return undefined;
	const redacted = redactSessionLabelSecrets(trimmed).trim();
	return redacted.length > 0 ? redacted : undefined;
}

export function fallbackSessionLabel(sessionId: string): string {
	return sessionId.slice(0, 8);
}

export function sessionListTitle(input: { sessionId: string; title?: string; firstMessage?: string }): string {
	return (
		meaningfulSessionLabel(input.title) ??
		meaningfulSessionLabel(input.firstMessage) ??
		fallbackSessionLabel(input.sessionId)
	);
}

/** Appends a short session-id suffix when several rows share the same visible label. */
export function disambiguateSessionLabel(base: string, sessionId: string, collidingCount: number): string {
	if (collidingCount <= 1) return base;
	const suffix = sessionId.slice(-4);
	if (base.endsWith(suffix)) return base;
	return `${base} · ${suffix}`;
}
