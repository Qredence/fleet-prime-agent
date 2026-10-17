import type { ChatClarificationQuestion } from "@prime-agent/web-protocol";

export interface DaemonQuestionOption {
	value: string;
	label: string;
	description?: string;
}

export interface NormalizedDaemonQuestion {
	id: string;
	question: string;
	options: Array<DaemonQuestionOption>;
	isMultiSelect: boolean;
	defaultOption?: string;
	allowWriteIn: boolean;
}

/**
 * Normalizes the heterogeneous question shapes emitted by daemon extensions
 * (`question`/`prompt`/`title` text, string or object options, camelCase or
 * snake_case flags) into a single canonical form. Returns `undefined` when
 * `raw` is not an array or yields no questions.
 */
export function normalizeDaemonQuestions(raw: unknown): Array<NormalizedDaemonQuestion> | undefined {
	if (!Array.isArray(raw)) return undefined;
	const questions: Array<NormalizedDaemonQuestion> = [];
	for (const [index, entry] of raw.entries()) {
		const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
		const question =
			typeof item.question === "string" && item.question.trim()
				? item.question
				: typeof item.prompt === "string" && item.prompt.trim()
					? item.prompt
					: typeof item.title === "string" && item.title.trim()
						? item.title
						: "";
		const options: Array<DaemonQuestionOption> = [];
		if (Array.isArray(item.options)) {
			for (const option of item.options) {
				if (typeof option === "string") {
					if (option.trim()) options.push({ value: option, label: option });
					continue;
				}
				if (!option || typeof option !== "object") continue;
				const record = option as Record<string, unknown>;
				const value =
					typeof record.value === "string"
						? record.value
						: typeof record.id === "string"
							? record.id
							: typeof record.label === "string"
								? record.label
								: undefined;
				if (value === undefined) continue;
				const label = typeof record.label === "string" && record.label.trim() ? record.label : value;
				const description =
					typeof record.description === "string" && record.description.trim() ? record.description : undefined;
				options.push(description === undefined ? { value, label } : { value, label, description });
			}
		}
		const isMultiSelect =
			typeof item.isMultiSelect === "boolean"
				? item.isMultiSelect
				: typeof item.is_multi_select === "boolean"
					? item.is_multi_select
					: item.kind === "multi";
		const allowWriteIn =
			typeof item.allowWriteIn === "boolean"
				? item.allowWriteIn
				: typeof item.allow_write_in === "boolean"
					? item.allow_write_in
					: typeof item.allowOther === "boolean"
						? item.allowOther
						: typeof item.allowCustom === "boolean"
							? item.allowCustom
							: false;
		questions.push({
			id: typeof item.id === "string" && item.id.trim() ? item.id : `question-${index + 1}`,
			question,
			options,
			isMultiSelect,
			...(typeof item.defaultOption === "string" ? { defaultOption: item.defaultOption } : {}),
			allowWriteIn,
		});
	}
	return questions.length > 0 ? questions : undefined;
}

/** Projects normalized questions into the `ChatPendingDialog` registry shape. */
export function normalizedQuestionsToClarification(
	questions: Array<NormalizedDaemonQuestion> | undefined,
): Array<ChatClarificationQuestion> | undefined {
	if (!questions) return undefined;
	return questions.map((q) => ({
		id: q.id,
		question: q.question,
		...(q.options.length > 0 ? { options: q.options.map((o) => o.value) } : {}),
		...(q.isMultiSelect ? { isMultiSelect: true } : {}),
		...(q.defaultOption !== undefined ? { defaultOption: q.defaultOption } : {}),
		...(q.allowWriteIn ? { allowWriteIn: true } : {}),
	}));
}

/**
 * Projects normalized questions into the wire shape consumed by the browser
 * question UI (`use-pending-question-bar` / `QuestionPrompt`): `prompt`/`title`
 * text, object options with `value`/`label`, an explicit `kind`, and
 * `allowOther`/`allowCustom` write-in flags.
 */
export function normalizedQuestionsToWire(
	questions: Array<NormalizedDaemonQuestion> | undefined,
): Array<Record<string, unknown>> | undefined {
	if (!questions || questions.length === 0) return undefined;
	return questions.map((q) => {
		let kind: "multi" | "single" | "text" = "text";
		if (q.isMultiSelect) kind = "multi";
		else if (q.options.length > 0) kind = "single";
		return {
			id: q.id,
			question: q.question,
			prompt: q.question,
			title: q.question,
			kind,
			...(q.options.length > 0 ? { options: q.options } : {}),
			...(q.allowWriteIn ? { allowOther: true, allowCustom: true } : {}),
			...(q.defaultOption !== undefined ? { defaultOption: q.defaultOption } : {}),
		};
	});
}
