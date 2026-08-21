export type TodoItem = {
	step: number;
	text: string;
	completed: boolean;
};

export function cleanStepText(text: string) {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
	}
	return cleaned;
}

export function extractTodoItems(message: string) {
	const items: Array<TodoItem> = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	// Plan-mode responses are already a controlled, user-visible contract. Some
	// providers return a concise numbered checklist without repeating "Plan:".
	// Accept that form only when it contains at least two valid numbered steps.
	const planSection = headerMatch ? message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length) : message;
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	if (!headerMatch && items.length < 2) {
		let stepNumber = 0;
		const titledSteps = Array.from(message.matchAll(/^\s*([A-Z][^:\n]{4,72}):\s+[^\n]+/gm)).flatMap((match) => {
			const text = cleanStepText(match[1] ?? "");
			if (text.length <= 3) return [];
			stepNumber += 1;
			return [{ step: stepNumber, text, completed: false }];
		});
		if (titledSteps.length >= 2) return titledSteps;
		const plainSteps = [
			...new Set(
				message.split(/\n+/).flatMap((line) => {
					const trimmed = line.trim();
					if (trimmed.length <= 5 || ["#", ">", "*", "-"].includes(trimmed.charAt(0))) return [];
					const text = cleanStepText(trimmed);
					return text.length > 3 ? [text] : [];
				}),
			),
		]
			.slice(0, 12)
			.map((text, index) => ({ step: index + 1, text, completed: false }));
		return plainSteps.length >= 2 ? plainSteps : [];
	}
	return items;
}

export function extractDoneSteps(message: string) {
	const steps: Array<number> = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

export function markCompletedSteps(text: string, items: Array<TodoItem>) {
	let changed = 0;
	const itemsByStep = new Map(items.map((todo) => [todo.step, todo]));
	for (const step of extractDoneSteps(text)) {
		const item = itemsByStep.get(step);
		if (item && !item.completed) {
			item.completed = true;
			changed += 1;
		}
	}
	return changed;
}
