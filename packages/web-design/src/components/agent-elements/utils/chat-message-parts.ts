import type { ComponentType } from "react";

import type { CustomToolRendererProps } from "../types";

export type ToolPartBase = {
	type: string;
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	result?: unknown;
};

export type ToolRendererProps = {
	part: ToolPartBase;
	nestedTools?: Array<ToolPartBase>;
	chatStatus?: string;
	toolRenderers?: Record<string, ComponentType<CustomToolRendererProps>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isTextPart(part: unknown): part is { type: "text"; text: string } {
	return isRecord(part) && part.type === "text" && typeof part.text === "string";
}

export function isErrorPart(part: unknown): part is { type: "error"; title?: string; message: string } {
	return isRecord(part) && part.type === "error" && typeof part.message === "string";
}

export function isV5ToolPart(part: unknown): part is ToolPartBase {
	if (!isRecord(part)) return false;
	const partType = part.type;
	return partType === "dynamic-tool" || (typeof partType === "string" && partType.startsWith("tool-"));
}

export function getTextFromParts(parts: Array<unknown>, joiner: string): string {
	return parts
		.filter(isTextPart)
		.map((part) => part.text)
		.join(joiner);
}
