import { type FleetErrorEnvelope, NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";

function getResponseStatus(error: unknown): number {
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

/** Keep local filesystem details out of API errors rendered by the browser. */
export function safeErrorMessage(error: unknown): string {
	const message = getErrorMessage(error);
	return message
		.replace(/(['"])(\/(?!\/)[^'"\n]*|[A-Za-z]:\\[^'"\n]*)\1/g, "$1[local path]$1")
		.replace(/(^|[\s'"(])\/(?!\/)[^'"\s)]+/g, "$1[local path]")
		.replace(/[A-Za-z]:\\[^'"\s)]+/g, "[local path]");
}

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

export function wrapApiHandler(handler: () => Promise<Response>): Promise<Response> {
	return handler().catch((error) => {
		const envelope = chatErrorEnvelope(error);
		if (envelope.code === "NETWORK_DISCONNECTED") {
			// Raw transport detail stays server-side.
			process.stderr.write(`[api] daemon transport failure: ${getErrorMessage(error)}\n`);
		}
		return Response.json(envelope, { status: getResponseStatus(error) });
	});
}
