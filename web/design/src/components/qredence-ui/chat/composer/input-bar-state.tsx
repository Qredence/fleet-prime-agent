import {
	type ComposerCommand,
	type ComposerPerson,
	useMentionMatches,
	useSlashMatches,
} from "@prime-agent/web-design/components/qredence-ui/chat/composer/composer-menu";
import type { ComposerTriggerGroup } from "@prime-agent/web-design/components/qredence-ui/chat/composer/composer-trigger-popover";
import type { SuggestionItem } from "@prime-agent/web-design/components/qredence-ui/chat/composer/input/suggestions";
import { useQuestionBarNavigation } from "@prime-agent/web-design/components/qredence-ui/chat/hooks/use-question-bar-navigation";
import type { WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { availableThinkingLevels, clampThinkingLevel, thinkingLevelLabel } from "../../../../lib/pi/chat-helpers";
import { ProviderBrandIcon } from "../../panels/config-panel/shared/provider-brand-icon";
import { formatProviderLabel } from "../../panels/config-panel/shared/provider-label";
import {
	type EditingState,
	INITIAL_EDITING_STATE,
	resolveInlineCompletion,
	sameEditingState,
	spliceCompletion,
} from "./inline-completion";
import type { InputBarProps } from "./input-bar";

type SuggestionConfig = NonNullable<InputBarProps["slashCommands"]>;
const EMPTY_WORKSPACE_REFERENCES: Array<WorkspaceAttachment> = [];
/** Matches the draft-classification debounce on the host side. */
const DRAFT_REPORT_DEBOUNCE_MS = 300;

function suggestionItems(config: SuggestionConfig | undefined) {
	if (!config) return [];
	return Array.isArray(config) ? config : config.items;
}

function slashCommandName(item: SuggestionItem) {
	return (item.value ?? item.id).trim().replace(/^\/+/, "").split(/\s+/, 1)[0] ?? item.id;
}

function slashArgumentHint(item: SuggestionItem) {
	const fromMetadata = item.metadata?.argumentHint?.trim();
	if (fromMetadata) return fromMetadata;
	const value = item.value?.trim() ?? "";
	const match = value.match(/^\/\S+\s+(.+)$/);
	return match?.[1];
}

export function useInputBarState({
	models,
	status,
	thinkingLevel,
	onModelChange,
	onThinkingLevelChange,
	onSend,
	onSlashCommandSelect,
	onLocalSlashSubmit,
	onDraftChange,
	intentSuggestion,
	inlineCompletion,
	modelPickerOpen,
	onModelPickerOpenChange,
	effortPickerOpen,
	onEffortPickerOpenChange,
	workspaceReferences = EMPTY_WORKSPACE_REFERENCES,
	workspaceSuggestions,
	onWorkspaceReferenceSelect,
	onRemoveWorkspaceReference,
	controlled,
	disabled,
	questionBar,
	attachments,
	slashCommands,
}: Pick<
	InputBarProps,
	| "models"
	| "status"
	| "thinkingLevel"
	| "onModelChange"
	| "onThinkingLevelChange"
	| "onSend"
	| "onSlashCommandSelect"
	| "onLocalSlashSubmit"
	| "onDraftChange"
	| "intentSuggestion"
	| "inlineCompletion"
	| "modelPickerOpen"
	| "onModelPickerOpenChange"
	| "effortPickerOpen"
	| "onEffortPickerOpenChange"
	| "workspaceReferences"
	| "workspaceSuggestions"
	| "onWorkspaceReferenceSelect"
	| "onRemoveWorkspaceReference"
	| "controlled"
	| "disabled"
	| "questionBar"
	| "attachments"
	| "slashCommands"
>) {
	const [internalValue, setInternalValue] = useState("");
	const [dismissedQuestionId, setDismissedQuestionId] = useState<string | null>(null);
	const [slashMenuPinned, setSlashMenuPinned] = useState(false);
	const value = controlled?.value ?? internalValue;
	const setValue = controlled?.onChange ?? setInternalValue;
	const isStreaming = status === "streaming" || status === "submitted";
	const navigation = useQuestionBarNavigation(questionBar);
	const commands = suggestionItems(slashCommands);
	const workspaceItems = suggestionItems(workspaceSuggestions);
	const slashElementCommands = useMemo<ComposerCommand[]>(
		() =>
			commands.map((item) => ({
				name: slashCommandName(item),
				description: [item.description, slashArgumentHint(item)].filter(Boolean).join(" "),
				icon: Sparkles,
			})),
		[commands],
	);
	const mentionElementPeople = useMemo<ComposerPerson[]>(
		() =>
			workspaceItems.map((item) => ({
				id: item.id,
				name: item.label,
				path: item.value ?? item.label,
				kind: item.metadata?.kind === "folder" ? "folder" : "file",
				description: item.description,
				role: "human",
			})),
		[workspaceItems],
	);
	const slashMatch = value.match(/^\/([^\s/]*)$/);
	const workspaceMentionMatch = value.match(/(?:^|\s)@([^\s@]*)$/);
	const slashQuery = slashMatch?.[1]?.toLowerCase() ?? (slashMenuPinned ? "" : undefined);
	const workspaceQuery = workspaceMentionMatch?.[1]?.toLowerCase();
	const triggerKind: "slash" | "mention" | undefined =
		workspaceQuery !== undefined ? "mention" : slashMatch || slashMenuPinned ? "slash" : undefined;
	const slashMatches = useSlashMatches(value, slashElementCommands);
	const filteredCommands = useMemo(() => {
		if (slashMenuPinned && !value.startsWith("/")) return commands;
		const matchingNames = new Set(slashMatches.map((item) => item.name));
		return commands.filter((item) => matchingNames.has(slashCommandName(item)));
	}, [commands, slashMatches, slashMenuPinned, value]);
	const mentionMatches = useMentionMatches(value, mentionElementPeople);
	const filteredWorkspaceItems = useMemo(() => {
		const matchingIds = new Set(mentionMatches.map((item) => item.id).filter((id): id is string => Boolean(id)));
		return workspaceItems.filter((item) => matchingIds.has(item.id));
	}, [mentionMatches, workspaceItems]);
	const triggerItems = triggerKind === "slash" ? filteredCommands : filteredWorkspaceItems;
	const [activeTriggerIndex, setActiveTriggerIndex] = useState(0);

	useEffect(() => {
		setActiveTriggerIndex(0);
	}, [triggerKind, slashQuery, workspaceQuery, triggerItems.length]);

	const send = useCallback(
		(content: string, altKey = false) => {
			if (onLocalSlashSubmit?.(content) === true) {
				setValue("");
				return;
			}
			onSend({ role: "user", content, altKey });
			setValue("");
		},
		[onLocalSlashSubmit, onSend, setValue],
	);

	// Report the draft on a pause so the host can classify it before submit.
	// Reporting is one-way: this can never change what Enter does.
	useEffect(() => {
		if (!onDraftChange) return;
		const timer = setTimeout(() => onDraftChange(value), DRAFT_REPORT_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [onDraftChange, value]);

	/**
	 * The chip is dropped the moment the draft moves past the one it was computed
	 * for. Without this a click landing in the debounce window after a keystroke
	 * would run the command against stale text and discard what was just typed.
	 */
	const visibleIntentSuggestion = intentSuggestion?.forValue === value ? intentSuggestion : undefined;

	const acceptIntentSuggestion = useCallback(() => {
		// Re-checked here too: the click handler is not guaranteed to see a render
		// that already dropped the chip.
		if (visibleIntentSuggestion?.forValue !== value) return;
		visibleIntentSuggestion.onAccept();
		setValue("");
	}, [value, visibleIntentSuggestion, setValue]);

	const removeTriggerToken = useCallback(
		(match: RegExpMatchArray | null) => {
			if (!match) return value;
			const leadingWhitespace = match[0].length - match[0].trimStart().length;
			const tokenStart = value.length - match[0].length + leadingWhitespace;
			return value.slice(0, tokenStart);
		},
		[value],
	);

	const closeTriggerMenu = useCallback(() => {
		if (slashMenuPinned) {
			setSlashMenuPinned(false);
			return;
		}
		if (triggerKind === "slash" && slashMatch) {
			setValue(removeTriggerToken(slashMatch));
			return;
		}
		if (triggerKind === "mention" && workspaceMentionMatch) {
			setValue(removeTriggerToken(workspaceMentionMatch));
		}
	}, [removeTriggerToken, setValue, slashMatch, slashMenuPinned, triggerKind, workspaceMentionMatch]);

	const selectCommand = useCallback(
		(item: SuggestionItem) => {
			setSlashMenuPinned(false);
			if (onSlashCommandSelect?.(item) === true) {
				setValue("");
				return;
			}
			setValue(item.value ?? item.label);
		},
		[onSlashCommandSelect, setValue],
	);

	const selectWorkspaceReference = useCallback(
		(item: SuggestionItem) => {
			setSlashMenuPinned(false);
			onWorkspaceReferenceSelect?.(item);
			setValue(removeTriggerToken(workspaceMentionMatch));
		},
		[onWorkspaceReferenceSelect, removeTriggerToken, setValue, workspaceMentionMatch],
	);

	// --- Inline completion ---------------------------------------------------

	const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
	const [editing, setEditing] = useState<EditingState>(INITIAL_EDITING_STATE);
	const composingRef = useRef(false);
	const pendingCaretRef = useRef<number | null>(null);
	const [dismissed, setDismissed] = useState<{ forValue: string; text: string } | undefined>(undefined);

	/**
	 * Live caret, read from the DOM at decision time rather than from React
	 * state, so an accept can never splice against a stale offset.
	 */
	const readCaret = useCallback((): { start: number; end: number } | null => {
		if (!textarea) return null;
		return { start: textarea.selectionStart ?? 0, end: textarea.selectionEnd ?? 0 };
	}, [textarea]);

	/**
	 * Publishes caret/focus/composition state for the render gate.
	 *
	 * Attached as native listeners rather than React props because
	 * `PromptInput` spreads `...textareaProps` before its own handlers, which
	 * silently drops any handler it does not explicitly compose.
	 *
	 * `keyup`/`click`/`mouseup` rather than `selectionchange`, which does not
	 * fire in the test DOM.
	 */
	useEffect(() => {
		if (!textarea) return;
		const publish = () => {
			const next: EditingState = {
				focused: document.activeElement === textarea,
				composing: composingRef.current,
				caretStart: textarea.selectionStart ?? null,
				caretEnd: textarea.selectionEnd ?? null,
			};
			setEditing((previous) => (sameEditingState(previous, next) ? previous : next));
		};
		const onCompositionStart = () => {
			composingRef.current = true;
			publish();
		};
		const onCompositionEnd = () => {
			composingRef.current = false;
			publish();
		};
		const events = ["keyup", "click", "mouseup", "select", "focus", "blur", "input", "scroll"];
		for (const type of events) textarea.addEventListener(type, publish);
		textarea.addEventListener("compositionstart", onCompositionStart);
		textarea.addEventListener("compositionend", onCompositionEnd);
		publish();
		return () => {
			for (const type of events) textarea.removeEventListener(type, publish);
			textarea.removeEventListener("compositionstart", onCompositionStart);
			textarea.removeEventListener("compositionend", onCompositionEnd);
		};
	}, [textarea]);

	const triggerOpen = Boolean(triggerKind && !isStreaming && !disabled);

	const offeredCompletion = useMemo(
		() =>
			resolveInlineCompletion({
				completion: inlineCompletion,
				value,
				editing,
				streaming: isStreaming,
				disabled: Boolean(disabled),
				triggerOpen,
				intentSuggestion: Boolean(intentSuggestion),
				dismissed,
			}),
		[dismissed, disabled, editing, inlineCompletion, intentSuggestion, isStreaming, triggerOpen, value],
	);

	const dismissInlineCompletion = useCallback(() => {
		if (offeredCompletion) setDismissed({ forValue: value, text: offeredCompletion.text });
		inlineCompletion?.onDismiss?.();
	}, [inlineCompletion, offeredCompletion, value]);

	const acceptInlineCompletion = useCallback(() => {
		if (!offeredCompletion) return;
		const caret = readCaret();
		// Re-checked here, not only in the render gate: the DOM is the authority.
		if (!caret || caret.start !== caret.end || caret.start !== value.length) return;
		const next = spliceCompletion(value, offeredCompletion.text);
		setValue(next);
		// Applied after the controlled value commits; writing the selection before
		// that would clamp the offset against the old, shorter value.
		pendingCaretRef.current = next.length;
		inlineCompletion?.onAccept?.(next);
	}, [inlineCompletion, offeredCompletion, readCaret, setValue, value]);

	useLayoutEffect(() => {
		const caret = pendingCaretRef.current;
		if (caret === null) return;
		pendingCaretRef.current = null;
		if (!textarea) return;
		if (textarea.selectionStart !== caret || textarea.selectionEnd !== caret) {
			textarea.setSelectionRange(caret, caret);
		}
	}, [textarea, value]);

	// --- End inline completion -----------------------------------------------

	const handlePromptKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
			const isSuggestionMenuOpen = !isStreaming && !disabled && triggerKind !== undefined;

			if (event.key === "Backspace" && value.length === 0 && workspaceReferences.length > 0) {
				const lastReference = workspaceReferences[workspaceReferences.length - 1];
				if (lastReference) {
					event.preventDefault();
					onRemoveWorkspaceReference?.(lastReference.relativePath);
					return;
				}
			}

			if (isSuggestionMenuOpen && event.key === "Escape") {
				event.preventDefault();
				closeTriggerMenu();
				return;
			}

			// The popover owns Tab only while it has something to select. With an open
			// token and no matches the key falls through to focus navigation, which is
			// safe because the menu items are not tab stops — otherwise Tab would
			// either trap focus in the composer or land inside the popover chrome.
			if (isSuggestionMenuOpen && triggerItems.length > 0) {
				if (event.key === "Tab" && !event.shiftKey) {
					event.preventDefault();
					const item = triggerItems[activeTriggerIndex];
					if (item) {
						if (triggerKind === "slash") selectCommand(item);
						else selectWorkspaceReference(item);
					}
					return;
				}
				if (event.key === "ArrowDown") {
					event.preventDefault();
					setActiveTriggerIndex((index) => (index + 1) % triggerItems.length);
					return;
				}
				if (event.key === "ArrowUp") {
					event.preventDefault();
					setActiveTriggerIndex((index) => (index - 1 + triggerItems.length) % triggerItems.length);
					return;
				}
				if (event.key === "Enter") {
					event.preventDefault();
					const item = triggerItems[activeTriggerIndex];
					if (item) {
						if (triggerKind === "slash") selectCommand(item);
						else selectWorkspaceReference(item);
					}
					return;
				}
			}

			// Inline completion. Consumed only when the ghost is actually painted, so
			// Tab is never swallowed with nothing to accept. Shift+Tab is left alone:
			// it walks focus backwards, which is what users expect.
			if (!event.nativeEvent.isComposing) {
				if (event.key === "Tab" && !event.shiftKey && offeredCompletion) {
					event.preventDefault();
					acceptInlineCompletion();
					return;
				}
				if (event.key === "Escape" && offeredCompletion) {
					event.preventDefault();
					dismissInlineCompletion();
					return;
				}
			}

			if (event.key === "Enter" && event.altKey && !event.shiftKey) {
				event.preventDefault();
				const content = value.trim();
				if (content && !disabled) send(content, true);
			}
		},
		[
			acceptInlineCompletion,
			activeTriggerIndex,
			closeTriggerMenu,
			disabled,
			dismissInlineCompletion,
			isStreaming,
			offeredCompletion,
			onRemoveWorkspaceReference,
			selectCommand,
			selectWorkspaceReference,
			send,
			triggerItems,
			triggerKind,
			value,
			workspaceReferences,
		],
	);

	const showQuestion = questionBar && questionBar.id !== dismissedQuestionId;
	const files = attachments?.files ?? [];
	const images = attachments?.images ?? [];
	const commandGroups = useMemo<ComposerTriggerGroup[]>(() => {
		if (triggerKind !== "slash") return [];
		const groups = new Map<string, SuggestionItem[]>();
		for (const item of filteredCommands) {
			const category = item.category ?? "builtin";
			const group = groups.get(category) ?? [];
			group.push(item);
			groups.set(category, group);
		}
		const labels: Record<string, string> = {
			builtin: "Built-in",
			extension: "Extensions",
			prompt: "Prompts",
			skill: "Skills",
		};
		return [...groups.entries()].map(([id, group]) => ({
			id,
			label: labels[id] ?? id,
			items: group.map((item) => ({
				...item,
				description: [item.description, slashArgumentHint(item)].filter(Boolean).join(" · "),
			})),
		}));
	}, [filteredCommands, triggerKind]);
	const selectorModels = useMemo(
		() =>
			models.map((model) => ({
				id: model.id,
				name: model.name,
				provider: model.provider,
				providerLabel: formatProviderLabel(model.provider),
				modelId: model.modelId,
				icon: <ProviderBrandIcon provider={model.provider} className="size-4" />,
				disabled: model.available === false,
				reasoning: model.reasoning,
				keywords: [model.provider, model.modelId, model.id],
				efforts: availableThinkingLevels(model).map((level) => ({
					id: level,
					name: thinkingLevelLabel(level),
				})),
			})),
		[models],
	);
	const combinedPickerOpen = modelPickerOpen === true || effortPickerOpen === true;
	const handleCombinedPickerOpenChange = useCallback(
		(open: boolean) => {
			onModelPickerOpenChange?.(open);
			onEffortPickerOpenChange?.(open);
		},
		[onEffortPickerOpenChange, onModelPickerOpenChange],
	);
	const handleSelectorModelChange = useCallback(
		(nextModelKey: string) => {
			const nextModel = models.find((model) => model.id === nextModelKey);
			onModelChange(nextModelKey);
			if (nextModel) {
				onThinkingLevelChange?.(clampThinkingLevel(thinkingLevel, availableThinkingLevels(nextModel)));
			}
		},
		[models, onModelChange, onThinkingLevelChange, thinkingLevel],
	);

	const openSlashMenu = useCallback(() => {
		if (isStreaming || disabled) return;
		setSlashMenuPinned(true);
		setActiveTriggerIndex(0);
		document.getElementById("composer-prompt")?.focus({ preventScroll: true });
	}, [disabled, isStreaming]);

	useEffect(() => {
		if (slashMatch) setSlashMenuPinned(false);
	}, [slashMatch]);

	useEffect(() => {
		if (isStreaming || disabled) setSlashMenuPinned(false);
	}, [disabled, isStreaming]);

	useEffect(() => {
		if (!triggerOpen) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			const menu = document.getElementById("composer-trigger-list");
			const prompt = document.getElementById("composer-prompt");
			if (menu?.contains(target)) return;
			if (prompt?.contains(target) || target === prompt) return;
			closeTriggerMenu();
		};

		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [closeTriggerMenu, triggerOpen]);

	return {
		acceptIntentSuggestion,
		activeTriggerIndex,
		attachTextarea: setTextarea,
		ghostText: offeredCompletion?.text,
		combinedPickerOpen,
		commandGroups,
		files,
		handleCombinedPickerOpenChange,
		handlePromptKeyDown,
		handleSelectorModelChange,
		images,
		isStreaming,
		navigation,
		openSlashMenu,
		closeTriggerMenu,
		selectorModels,
		removeTriggerToken,
		selectCommand,
		selectWorkspaceReference,
		send,
		setActiveTriggerIndex,
		setDismissedQuestionId,
		setValue,
		showQuestion,
		triggerItems,
		triggerKind,
		triggerOpen,
		slashMatch,
		slashQuery,
		workspaceMentionMatch,
		workspaceQuery,
		filteredCommands,
		filteredWorkspaceItems,
		value,
		visibleIntentSuggestion,
	};
}
