import { type FleetErrorEnvelope, NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";
import { FleetErrorEnvelopeDecodeSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { COMPOSER_INTENT_COMMANDS } from "@prime-agent/web-protocol/composer-intent";
import { ZodError } from "zod";
import { isLoopbackHostname } from "./net";
import { withSessionLeaseScope } from "./session-lease-scope";

function getResponseStatus(error: unknown): number {
	// Zod carries no .status; surface schema/parse failures as 422, not 500.
	// The name check covers ZodError instances from a duplicate zod copy.
	if (error instanceof ZodError || (error instanceof Error && error.name === "ZodError")) return 422;
	if (error && typeof error === "object" && "status" in error) {
		const status = (error as { status?: unknown }).status;
		if (typeof status === "number" && status >= 400 && status < 600) return status;
	}
	return 500;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

const PUBLIC_SLASH_COMMANDS = new Set(COMPOSER_INTENT_COMMANDS.map((command) => `/${command.id}`));

/** Keep local filesystem details and secrets out of API errors rendered by the browser. */
export function safeErrorMessage(error: unknown): string {
	const message = getErrorMessage(error);
	return SECRET_PATTERNS.reduce(
		(scrubbed, [pattern, replacement]) => scrubbed.replace(pattern, replacement),
		message
			.replace(/(['"])(\/(?!\/)[^'"\n]*|[A-Za-z]:\\[^'"\n]*)\1/g, "$1[local path]$1")
			.replace(/(^|[\s'"(])\/(?!\/)[^'"\s)]+/g, (path: string, prefix: string, offset: number, source: string) => {
				const token = path.slice(prefix.length);
				// Public commands and method-qualified API routes are not filesystem paths.
				const apiRoute =
					/^\/api\/[a-z0-9/-]+$/.test(token) &&
					/\b(?:GET|POST|PATCH|PUT|DELETE) $/.test(source.slice(0, offset + prefix.length));
				return PUBLIC_SLASH_COMMANDS.has(token) || apiRoute ? path : `${prefix}[local path]`;
			})
			.replace(/[A-Za-z]:\\[^'"\s)]+/g, "[local path]"),
	);
}

/** Secret shapes redacted from API errors and server-side transport logs. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
	// Authorization: Bearer <token> / bearer <token>
	[/\b(bearer\s+)[A-Za-z0-9\-._~+/=]{8,}/gi, "$1[redacted]"],
	// apiKey/api_key/FooApiKey assignments, including FOO_API_KEY=... env style
	[/(api[_-]?key\s*[:=]\s*)["']?[^"'\s;,]+["']?/gi, "$1[redacted]"],
	// Generic key=... assignments (covers ?key=API_KEY query params)
	[/\bkey(\s*=\s*)[^"'\s;&,]+/gi, "key$1[redacted]"],
];

const DAEMON_DISCONNECT_PATTERNS = [/cannot send daemon command/i, /daemon is not connected/i];

/**
 * The upstream daemon SDK reports transport failures as free-form message
 * strings carrying socket and log paths. Recognize them by shape so the raw
 * detail never reaches the browser.
 */
export function isDaemonDisconnectError(error: unknown): boolean {
	const message = getErrorMessage(error);
	return DAEMON_DISCONNECT_PATTERNS.some((pattern) => pattern.test(message));
}

/** Typed error envelope shared by the REST and stream error surfaces. */
export function chatErrorEnvelope(error: unknown): FleetErrorEnvelope {
	if (isDaemonDisconnectError(error)) {
		return {
			code: "NETWORK_DISCONNECTED",
			message: NETWORK_DISCONNECTED_MESSAGE,
			remediation: { action: "reconnect", label: "Reconnect runtime" },
		};
	}
	return { code: "UNKNOWN_ERROR", message: safeErrorMessage(error) };
}

/**
 * CSRF guard for state-changing routes. Allows requests with no Origin
 * (non-browser clients), same-host origins (same-origin production), and
 * loopback origins (Vite dev on 127.0.0.1:3000 / localhost); rejects the rest.
 */
function isOriginAllowed(request: Request): boolean {
	const origin = request.headers.get("origin");
	if (!origin) return true;
	let originUrl: URL;
	try {
		originUrl = new URL(origin);
	} catch {
		return false;
	}
	if (isLoopbackHostname(originUrl.hostname)) return true;
	try {
		return originUrl.host.toLowerCase() === new URL(request.url).host.toLowerCase();
	} catch {
		return true;
	}
}

/** Add the canonical envelope to explicit HTTP failures without changing endpoint metadata. */
async function normalizeApiErrorResponse(response: Response): Promise<Response> {
	if (response.status < 400) return response;
	const body: unknown = await response.json().catch(() => undefined);
	const fields =
		typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
	const parsed = FleetErrorEnvelopeDecodeSchema.safeParse(body);
	const envelope: FleetErrorEnvelope = parsed.success
		? { ...parsed.data, message: safeErrorMessage(parsed.data.message) }
		: { code: "UNKNOWN_ERROR", message: `Request failed (${response.status})` };
	// Preserve the interpreter SDK's legacy error field while normalizing the top level.
	if (typeof fields.error === "string") fields.error = safeErrorMessage(fields.error);
	else if (typeof fields.error === "object" && fields.error !== null && "message" in fields.error) {
		fields.error = { ...fields.error, message: safeErrorMessage(fields.error.message) };
	}
	// Canonical optional fields may only come from the validated envelope.
	delete fields.provider;
	delete fields.isTerminal;
	delete fields.remediation;
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	headers.delete("content-encoding");
	headers.set("Content-Type", "application/json");
	return Response.json(
		{ ...fields, ...envelope },
		{ status: response.status, statusText: response.statusText, headers },
	);
}

export function wrapApiHandler(handler: () => Promise<Response>, request: Request): Promise<Response> {
	if (request.method.toUpperCase() !== "GET" && !isOriginAllowed(request)) {
		const envelope: FleetErrorEnvelope = { code: "UNKNOWN_ERROR", message: "Cross-origin request rejected." };
		return Promise.resolve(Response.json(envelope, { status: 403 }));
	}
	return withSessionLeaseScope(handler)
		.then(normalizeApiErrorResponse)
		.catch((error) => {
			const envelope = chatErrorEnvelope(error);
			if (envelope.code === "NETWORK_DISCONNECTED") {
				// Raw transport detail stays server-side; scrub secrets before logging.
				process.stderr.write(`[api] daemon transport failure: ${safeErrorMessage(error)}\n`);
			}
			return Response.json(envelope, { status: getResponseStatus(error) });
		});
}
