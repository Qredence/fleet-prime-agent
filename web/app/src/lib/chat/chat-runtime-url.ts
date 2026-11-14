const RUNTIME_API_PREFIXES = ["/api/health", "/api/chat", "/api/projects", "/api/workspace"] as const;

function resolveChatRuntimeBaseUrl() {
	const fromVite = import.meta.env.VITE_FLEET_PI_CHAT_RUNTIME_URL;
	if (typeof fromVite === "string" && fromVite.trim()) {
		return fromVite.trim().replace(/\/$/, "");
	}
	return "";
}

function isChatRuntimePath(path: string) {
	return RUNTIME_API_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`),
	);
}

export function resolveChatApiUrl(path: string) {
	const base = resolveChatRuntimeBaseUrl();
	if (!base) {
		return path;
	}

	const [pathname] = path.split("?");
	if (!isChatRuntimePath(pathname)) {
		return path;
	}

	return `${base}${path}`;
}

export type ChatEventsUrlOptions = {
	sessionId?: string;
	parentSessionId?: string;
	childId?: string;
	streamGeneration?: string;
	lastEventId?: number;
};

/** Builds the SSE events URL for either a root session or a subagent child stream. */
export function buildChatEventsUrl(options: ChatEventsUrlOptions): string {
	const params = new URLSearchParams();
	if (options.sessionId) params.set("sessionId", options.sessionId);
	if (options.parentSessionId) params.set("parentSessionId", options.parentSessionId);
	if (options.childId) params.set("childId", options.childId);
	if (options.streamGeneration) params.set("streamGeneration", options.streamGeneration);
	if (options.lastEventId && options.lastEventId > 0) params.set("lastEventId", String(options.lastEventId));
	return resolveChatApiUrl(`/api/chat/events?${params}`);
}
