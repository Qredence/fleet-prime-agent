import type { ChatMessage, ChatToolPart } from "@prime-agent/web-protocol/chat-types";
import { isChatToolPart } from "@prime-agent/web-protocol/chat-types";
import { SESSION_OUTPUT_PREVIEW_LIMIT, type SessionOutputRow } from "@prime-agent/web-protocol/openui-tools";

function previewText(value: unknown): string {
	let text = "";
	if (typeof value === "string") text = value;
	else if (value !== null && value !== undefined) {
		try {
			text = JSON.stringify(value);
		} catch {
			text = "";
		}
	}
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= SESSION_OUTPUT_PREVIEW_LIMIT) return flat;
	return `${flat.slice(0, SESSION_OUTPUT_PREVIEW_LIMIT - 1)}…`;
}

function toolPreview(part: ChatToolPart): string {
	if (typeof part.error === "string" && part.error.trim()) return part.error;
	if (part.output !== undefined) return previewText(part.output);
	if (part.result !== undefined) return previewText(part.result);
	if (part.backgroundOutput) return part.backgroundOutput;
	return "";
}

/**
 * Text and tool rows for one session, oldest first.
 *
 * Returns every row; callers apply their own page size. Keeping the limit out
 * of here lets a summary report the session total instead of the page size.
 *
 * Reasoning parts are omitted. They stay on the transcript's reasoning
 * surface and are not dashboard data.
 */
function sessionOutputRows(messages: readonly ChatMessage[]): SessionOutputRow[] {
	const rows: SessionOutputRow[] = [];
	messages.forEach((message, index) => {
		for (const part of message.parts) {
			if (part.type === "reasoning") continue;
			if (part.type === "text") {
				const preview = previewText(part.text);
				if (!preview) continue;
				rows.push({ turn: index + 1, role: message.role, kind: "text", toolName: "", preview });
				continue;
			}
			if (!isChatToolPart(part)) continue;
			const toolName = part.toolName ?? part.type.slice("tool-".length);
			rows.push({
				turn: index + 1,
				role: message.role,
				kind: "tool",
				toolName,
				preview: previewText(toolPreview(part)),
			});
		}
	});
	return rows;
}

export type SessionOutputPage = {
	rows: SessionOutputRow[];
	columns: SessionOutputColumns;
	total: number;
	toolCalls: number;
};

/**
 * One page of session rows, with totals from the full session.
 *
 * `total` and `toolCalls` count every row. `rows` and `columns` are the page
 * the table displays. Walking once keeps those totals from drifting apart.
 */
export function pageSessionOutputs(messages: readonly ChatMessage[], limit: number): SessionOutputPage {
	const rows = sessionOutputRows(messages);
	const page = rows.slice(0, limit);
	return {
		rows: page,
		columns: sessionOutputColumns(page),
		total: rows.length,
		toolCalls: rows.filter((row) => row.kind === "tool").length,
	};
}

export type SessionOutputColumns = {
	turn: number[];
	role: string[];
	kind: string[];
	toolName: string[];
	preview: string[];
};

/**
 * The same rows, projected field-by-field.
 *
 * `Table([Col(...)])` takes one primitive array per column, and openui-lang has
 * no projection builtin, so a component cannot derive a column from `rows`.
 * Passing whole row objects renders blank cells. The tool therefore returns the
 * projection alongside the rows, already sliced to the page the caller sees.
 */
function sessionOutputColumns(rows: readonly SessionOutputRow[]): SessionOutputColumns {
	return {
		turn: rows.map((row) => row.turn),
		role: rows.map((row) => row.role),
		kind: rows.map((row) => row.kind),
		toolName: rows.map((row) => row.toolName),
		preview: rows.map((row) => row.preview),
	};
}
