import type { Logger } from "pino"

// v1: replace the fleet-pi versions that reached into dropped server files.
function getResponseStatus(error: unknown): number {
	if (error && typeof error === "object" && "status" in error) {
		const status = (error as { status?: unknown }).status
		if (typeof status === "number" && status >= 400 && status < 600) return status
	}
	return 500
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === "string") return error
	try {
		return JSON.stringify(error)
	} catch {
		return String(error)
	}
}

export function wrapApiHandler(
	handler: () => Promise<Response>,
	options: { log?: Logger } = {}
): Promise<Response> {
	return handler().catch((error) => {
		options.log?.error({ error: getErrorMessage(error) }, "api handler failed")
		return Response.json(
			{ message: getErrorMessage(error) },
			{ status: getResponseStatus(error) }
		)
	})
}
