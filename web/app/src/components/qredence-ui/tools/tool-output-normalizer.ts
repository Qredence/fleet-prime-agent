import type { AgentCodeLanguage } from "@/components/qredence-ui/tools/agent-code";
import type { CitationItem } from "@/components/qredence-ui/tools/citations";
import type { FileDiffLine } from "@/components/qredence-ui/tools/file-diff";
import type { TodoItem } from "@/components/qredence-ui/tools/todo-list";
import type { ToolResultStatus } from "@/components/qredence-ui/tools/tool-result";
import { isSafeExternalUrl } from "@/lib/safe-external-url";

export type ToolRecord = Record<string, unknown>;

export interface ToolOutputSummary {
	record?: ToolRecord;
	details?: ToolRecord;
	stdout?: string;
	stderr?: string;
	result?: unknown;
	error?: string;
	durationMs?: number;
	kernelRestarted?: boolean;
	structured: boolean;
}

export type ToolOutputSection = {
	label: "stdout" | "stderr" | "result" | "error" | "output";
	content: string;
	language: AgentCodeLanguage;
};

export type ToolDetail =
	| {
			kind: "output";
			content: string;
			language: AgentCodeLanguage;
			structured: boolean;
			sections: ToolOutputSection[];
			sourceCode?: string;
			sourceLanguage?: AgentCodeLanguage;
			sourceLabel?: string;
	  }
	| {
			kind: "diff";
			file: string;
			lines: FileDiffLine[];
			copyText: string;
	  }
	| {
			kind: "todo";
			title: string;
			items: TodoItem[];
	  }
	| {
			kind: "citations";
			citations: CitationItem[];
	  }
	| {
			kind: "image";
			url: string;
	  };

export interface NormalizedToolPart {
	id: string;
	name: string;
	lowerName: string;
	status: ToolResultStatus;
	input?: ToolRecord;
	output?: unknown;
	outputSummary: ToolOutputSummary;
	command?: string;
	metadata: string[];
	approval?: ToolRecord;
	detail?: ToolDetail;
}

function asRecord(value: unknown): ToolRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as ToolRecord) : undefined;
}

function parseRecord(value: unknown): ToolRecord | undefined {
	const direct = asRecord(value);
	if (direct) return direct;
	if (typeof value !== "string") return undefined;

	try {
		return asRecord(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function getString(record: ToolRecord | undefined, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

function getNumber(record: ToolRecord | undefined, ...keys: string[]): number | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.trim()) {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return undefined;
}

function getBoolean(record: ToolRecord | undefined, ...keys: string[]): boolean | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "boolean") return value;
	}
	return undefined;
}

export function stringifyToolValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function getOutput(part: ToolRecord): unknown {
	if (part.output !== undefined && part.output !== null) return part.output;
	return part.result;
}

function summarizeOutput(output: unknown): ToolOutputSummary {
	const record = parseRecord(output);
	const details = parseRecord(record?.details);
	const fields: ToolRecord = {
		...(record ?? {}),
		...(details ?? {}),
	};
	const result = fields.result;
	const stdout = getString(fields, "stdout", "standardOutput", "standard_output");
	const stderr = getString(fields, "stderr", "standardError", "standard_error");
	const errorValue = fields.error ?? fields.errorMessage ?? fields.evalue;
	const error = errorValue === undefined ? undefined : stringifyToolValue(errorValue);
	const durationMs = getNumber(fields, "durationMs", "duration_ms", "duration");
	const kernelRestarted = getBoolean(fields, "kernelRestarted", "kernel_restarted");
	const structuredKeys = new Set([
		"stdout",
		"stderr",
		"standardOutput",
		"standard_output",
		"standardError",
		"standard_error",
		"error",
		"errorMessage",
		"evalue",
		"durationMs",
		"duration_ms",
		"duration",
		"kernelRestarted",
		"kernel_restarted",
		"status",
		"isError",
	]);
	const hasStructuredFields = Object.keys(fields).some((key) => !structuredKeys.has(key));
	const structured =
		!stdout && !stderr && !error && ((typeof result === "object" && result !== null) || hasStructuredFields);

	return {
		record,
		details,
		stdout,
		stderr,
		result,
		error,
		durationMs,
		kernelRestarted,
		structured,
	};
}

function getOutputSections(summary: ToolOutputSummary, output: unknown): ToolOutputSection[] {
	const sections: ToolOutputSection[] = [];
	if (summary.stdout) sections.push({ label: "stdout", content: summary.stdout, language: "text" });
	if (summary.stderr) sections.push({ label: "stderr", content: summary.stderr, language: "text" });
	if (summary.result !== undefined) {
		sections.push({
			label: "result",
			content: stringifyToolValue(summary.result),
			language: typeof summary.result === "object" && summary.result !== null ? "json" : "text",
		});
	}
	if (summary.error) sections.push({ label: "error", content: summary.error, language: "text" });
	if (sections.length > 0) return sections;

	const record = summary.details ?? summary.record;
	if (record) {
		const withoutEnvelope = { ...record };
		delete withoutEnvelope.details;
		delete withoutEnvelope.isError;
		if (Object.keys(withoutEnvelope).length > 0) {
			return [{ label: "result", content: stringifyToolValue(withoutEnvelope), language: "json" }];
		}
	}

	const fallback = stringifyToolValue(output);
	return fallback.trim() ? [{ label: "output", content: fallback, language: "text" }] : [];
}

function getOutputContent(summary: ToolOutputSummary, output: unknown): string {
	return getOutputSections(summary, output)
		.map((section) => `${section.label}\n${section.content}`)
		.join("\n\n");
}

function getInput(part: ToolRecord): ToolRecord | undefined {
	return parseRecord(part.input) ?? parseRecord(part.args);
}

function getArray(record: ToolRecord | undefined, ...keys: string[]): unknown[] | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (Array.isArray(value)) return value;
	}
	return undefined;
}

function getDiff(input: ToolRecord | undefined, summary: ToolOutputSummary): string | undefined {
	return getString(summary.details ?? summary.record, "diff", "patch") ?? getString(input, "diff", "patch");
}

function getFilePath(input: ToolRecord | undefined, summary: ToolOutputSummary): string {
	return (
		getString(input, "path", "filePath", "filename", "file") ??
		getString(summary.details ?? summary.record, "path", "filePath", "filename", "file") ??
		"workspace file"
	);
}

export function parseDiffLines(diff: string): FileDiffLine[] {
	return diff.split("\n").map((content, index) => ({
		id: `${index}-${content.slice(0, 16)}`,
		type:
			content.startsWith("+") && !content.startsWith("+++")
				? "added"
				: content.startsWith("-") && !content.startsWith("---")
					? "removed"
					: "context",
		content,
	}));
}

function getTodos(input: ToolRecord | undefined, summary: ToolOutputSummary): TodoItem[] {
	const output = summary.details ?? summary.record;
	const plan = parseRecord(input?.plan) ?? parseRecord(output?.plan);
	const source =
		getArray(input, "todos") ?? getArray(plan, "todos", "items") ?? getArray(output, "todos", "newTodos", "items");
	if (!source) return [];

	return source.flatMap((item, index) => {
		const record = asRecord(item);
		if (!record) return [];
		const title = getString(record, "content", "title", "text", "label");
		if (!title) return [];
		const rawStatus = getString(record, "status");
		const status =
			rawStatus === "in_progress" || rawStatus === "in-progress"
				? "in-progress"
				: rawStatus === "completed"
					? "completed"
					: rawStatus === "cancelled"
						? "cancelled"
						: "pending";
		return [{ id: `${index}-${title}`, title, status } satisfies TodoItem];
	});
}

function getCitations(summary: ToolOutputSummary): CitationItem[] {
	const output = summary.details ?? summary.record;
	const source = getArray(output, "results", "sources", "citations");
	if (!source) return [];

	return source.flatMap((item, index) => {
		const record = asRecord(item);
		if (!record) return [];
		const title = getString(record, "title", "name", "snippet");
		if (!title) return [];
		const rawUrl = getString(record, "url", "link");
		const url = rawUrl && isSafeExternalUrl(rawUrl) ? rawUrl : undefined;
		return [
			{
				id: `${index}-${title}`,
				title,
				url,
				domain: getString(record, "domain", "source"),
			},
		];
	});
}

function getImageUrl(summary: ToolOutputSummary): string | undefined {
	return getString(summary.details ?? summary.record, "url", "imageUrl", "image_url");
}

function getApproval(input: ToolRecord | undefined, summary: ToolOutputSummary): ToolRecord | undefined {
	return asRecord(input?.approval) ?? asRecord(summary.details?.approval) ?? asRecord(summary.record?.approval);
}

function toolName(part: ToolRecord): string {
	const type = typeof part.type === "string" ? part.type : "Tool";
	return type.startsWith("tool-") ? type.slice(5) : type;
}

function resultStatus(part: ToolRecord, chatStatus?: string): ToolResultStatus {
	const state = typeof part.state === "string" ? part.state : undefined;
	if (state === "output-error" || state === "error") return "error";
	if (state === "output-available" || state === "complete" || state === "success") return "success";
	if (state === "cancelled" || state === "canceled" || state === "aborted" || state === "interrupted")
		return "cancelled";
	if (part.error !== undefined) return "error";
	if (state === "input-streaming" || state === "streaming") {
		return chatStatus === "streaming" ? "running" : "cancelled";
	}
	if (part.output !== undefined || part.result !== undefined) return "success";
	return chatStatus === "streaming" ? "running" : "cancelled";
}

function languageFor(name: string, structured: boolean): AgentCodeLanguage {
	if (structured || name.toLowerCase().includes("json")) return "json";
	if (name.toLowerCase().includes("bash") || name.toLowerCase().includes("shell")) return "bash";
	if (name.toLowerCase().includes("python")) return "python";
	return "text";
}

function sourceLanguageFor(name: string, command: string | undefined): AgentCodeLanguage | undefined {
	if (!command) return undefined;
	const lowerName = name.toLowerCase();
	if (lowerName.includes("bash") || lowerName.includes("shell")) return "bash";
	if (lowerName.includes("python")) return /^\s*%%bash(?:\s|$)/im.test(command) ? "bash" : "python";
	return "text";
}

function sourceLabelFor(name: string, language: AgentCodeLanguage | undefined): string | undefined {
	if (!language) return undefined;
	const lowerName = name.toLowerCase();
	if (lowerName.includes("ipython")) return "IPython";
	if (lowerName.includes("bash") || lowerName.includes("shell")) return "Bash";
	if (lowerName.includes("python")) return "Python";
	if (language === "json") return "JSON";
	if (language === "text") return "Text";
	return language.toUpperCase();
}

const normalizeCache = new WeakMap<object, { chatStatus: string | undefined; value: NormalizedToolPart | undefined }>();

export function normalizeToolPart(part: unknown, chatStatus?: string): NormalizedToolPart | undefined {
	if (part && typeof part === "object") {
		const cached = normalizeCache.get(part);
		if (cached && cached.chatStatus === chatStatus) return cached.value;
		const value = normalizeToolPartUncached(part, chatStatus);
		normalizeCache.set(part, { chatStatus, value });
		return value;
	}
	return normalizeToolPartUncached(part, chatStatus);
}

function normalizeToolPartUncached(part: unknown, chatStatus?: string): NormalizedToolPart | undefined {
	const source = asRecord(part);
	if (!source) return undefined;
	const name = toolName(source);
	const lowerName = name.toLowerCase();
	const input = getInput(source);
	const output = getOutput(source);
	const outputSummary = summarizeOutput(output);
	const status = resultStatus(source, chatStatus);
	const command = getString(input, "command", "cmd", "code", "script");
	const sourceLanguage = sourceLanguageFor(name, command);
	const metadata: string[] = [];
	if (outputSummary.durationMs !== undefined) metadata.push(`${outputSummary.durationMs}ms`);
	if (outputSummary.kernelRestarted) metadata.push("kernel restarted");

	const diff = getDiff(input, outputSummary);
	const todos = lowerName.includes("todo") || lowerName.includes("plan") ? getTodos(input, outputSummary) : [];
	const citations =
		lowerName.includes("search") ||
		lowerName.includes("web") ||
		lowerName.includes("source") ||
		lowerName.includes("citation")
			? getCitations(outputSummary)
			: [];
	const imageUrl =
		lowerName.includes("image") || lowerName.includes("generat") ? getImageUrl(outputSummary) : undefined;
	const approval = getApproval(input, outputSummary);
	const content = getOutputContent(outputSummary, output);
	const hasOutputContent = Boolean(content.trim());
	const id =
		typeof source.toolCallId === "string" && source.toolCallId
			? source.toolCallId
			: `${name}-${JSON.stringify(input ?? {})}`;

	let detail: ToolDetail | undefined;
	if (todos.length > 0) {
		detail = { kind: "todo", title: lowerName.includes("plan") ? "Plan" : "Todo list", items: todos };
	} else if (citations.length > 0) {
		detail = { kind: "citations", citations };
	} else if (imageUrl) {
		detail = { kind: "image", url: imageUrl };
	} else if (diff && (lowerName.includes("edit") || lowerName.includes("write") || lowerName.includes("patch"))) {
		detail = { kind: "diff", file: getFilePath(input, outputSummary), lines: parseDiffLines(diff), copyText: diff };
	} else if (command || hasOutputContent || approval || metadata.length > 0) {
		detail = {
			kind: "output",
			content,
			language: languageFor(name, outputSummary.structured),
			structured: outputSummary.structured,
			sections: getOutputSections(outputSummary, output),
			sourceCode: command,
			sourceLanguage,
			sourceLabel: sourceLabelFor(name, sourceLanguage),
		};
	}

	return {
		id,
		name,
		lowerName,
		status,
		input,
		output,
		outputSummary,
		command,
		metadata,
		approval,
		detail,
	};
}
