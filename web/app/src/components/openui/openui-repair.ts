import type { OpenUIError } from "@openuidev/react-lang";

/**
 * Formats OpenUI's structured errors into a repair request the model can act on.
 *
 * Upstream shapes these errors for exactly this purpose: `statementId` points at
 * the line to patch, `hint` carries the corrective context, and `severity:
 * "warning"` means the program still rendered. A generic "fix your last answer"
 * makes the model guess; naming the statement and the expected signature does not.
 *
 * Errors are deduplicated because the parser re-runs on every stream chunk and
 * can report the same code for the same statement repeatedly.
 */

/** Only the fields the repair text uses; `code` stays open for forward-compatible codes. */
export type RepairableOpenUIError = {
	code: string;
	message: string;
	statementId?: string;
	component?: string;
	path?: string;
	hint?: string;
	severity?: "warning";
};

export function isRepairableError(error: RepairableOpenUIError): boolean {
	return error.severity !== "warning";
}

function describeError(error: RepairableOpenUIError): string {
	const component = error.component ? ` ${error.component}` : "";
	const statement = error.statementId ? ` "${error.statementId}"` : "";
	const path = error.path ? ` at ${error.path}` : "";
	const hint = error.hint ? ` Hint: ${error.hint}` : "";
	return `- [${error.code}]${component}${statement}${path}: ${error.message}${hint}`;
}

/**
 * Builds the repair message, or `undefined` when nothing is repairable (for
 * example a lone `no-root` warning, which the renderer already handled).
 */
export function buildOpenUIRepairRequest(errors: ReadonlyArray<RepairableOpenUIError>): string | undefined {
	const repairable = errors.filter(isRepairableError);
	if (repairable.length === 0) return undefined;

	const seen = new Set<string>();
	const lines: string[] = [];
	for (const error of repairable) {
		const key = `${error.code}:${error.statementId ?? ""}:${error.path ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		lines.push(describeError(error));
	}

	return [
		"The OpenUI block in your previous response did not render. Fix the statements below and return the corrected OpenUI block.",
		"Keep the parts that already worked; change only what the errors name.",
		"",
		...lines,
	].join("\n");
}

/** Narrows renderer-reported errors (parser, runtime, or diagnostic) into the repair shape. */
export function toRepairableErrors(
	errors: ReadonlyArray<OpenUIError | { code: string; message: string; source?: string }>,
): RepairableOpenUIError[] {
	return errors.map((error) => ({
		code: error.code,
		message: error.message,
		statementId: "statementId" in error ? error.statementId : undefined,
		component: "component" in error ? error.component : undefined,
		path: "path" in error ? error.path : undefined,
		hint: "hint" in error ? error.hint : undefined,
		severity: "severity" in error ? error.severity : undefined,
	}));
}
