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

export function wrapApiHandler(handler: () => Promise<Response>): Promise<Response> {
	return handler().catch((error) => {
		return Response.json({ message: safeErrorMessage(error) }, { status: getResponseStatus(error) });
	});
}
