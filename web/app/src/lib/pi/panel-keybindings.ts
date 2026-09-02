import type { RightPanelState } from "@prime-agent/web-protocol/fleet-contract";
import { useEffect } from "react";

export type FleetPanelKeybindingAction =
	| "toggleResources"
	| "toggleWorkspace"
	| "toggleArtifacts"
	| "toggleRepl"
	| "toggleSubagents"
	| "closePanel"
	| "focusPanel"
	| "focusChat";

export type FleetKeybinding = {
	code: string;
	ctrlOrMeta?: boolean;
	shift?: boolean;
	alt?: boolean;
};

export const FLEET_PANEL_KEYBINDINGS_STORAGE_KEY = "fleet-prime:v1:panel-keybindings";

export const DEFAULT_FLEET_PANEL_KEYBINDINGS: Record<FleetPanelKeybindingAction, FleetKeybinding> = {
	toggleResources: { code: "Digit1", ctrlOrMeta: true, shift: true },
	toggleWorkspace: { code: "Digit2", ctrlOrMeta: true, shift: true },
	toggleArtifacts: { code: "Digit3", ctrlOrMeta: true, shift: true },
	toggleRepl: { code: "Digit4", ctrlOrMeta: true, shift: true },
	toggleSubagents: { code: "Digit5", ctrlOrMeta: true, shift: true },
	closePanel: { code: "Escape" },
	focusPanel: { code: "KeyP", ctrlOrMeta: true, shift: true },
	focusChat: { code: "KeyC", ctrlOrMeta: true, shift: true },
};

function readKeybindings(): Record<FleetPanelKeybindingAction, FleetKeybinding> {
	try {
		const value = window.localStorage.getItem(FLEET_PANEL_KEYBINDINGS_STORAGE_KEY);
		if (!value) return DEFAULT_FLEET_PANEL_KEYBINDINGS;
		const overrides = JSON.parse(value) as Partial<Record<FleetPanelKeybindingAction, FleetKeybinding>>;
		return { ...DEFAULT_FLEET_PANEL_KEYBINDINGS, ...overrides };
	} catch {
		return DEFAULT_FLEET_PANEL_KEYBINDINGS;
	}
}

function matches(event: KeyboardEvent, binding: FleetKeybinding): boolean {
	return (
		event.code === binding.code &&
		(event.ctrlKey || event.metaKey) === Boolean(binding.ctrlOrMeta) &&
		event.shiftKey === Boolean(binding.shift) &&
		event.altKey === Boolean(binding.alt)
	);
}

function focusChatComposer(): void {
	const target = document.querySelector<HTMLElement>(
		"[data-fleet-chat-focus] textarea, [data-fleet-chat-focus] [contenteditable='true'], [data-fleet-chat-focus] input",
	);
	target?.focus({ preventScroll: true });
}

export function usePanelKeybindings({
	rightPanel,
	setRightPanel,
}: {
	rightPanel: RightPanelState;
	setRightPanel: (panel: RightPanelState) => void;
}): void {
	useEffect(() => {
		const keybindings = readKeybindings();
		const handleKeyDown = (event: KeyboardEvent) => {
			const match = (action: FleetPanelKeybindingAction) => matches(event, keybindings[action]);
			let handled = true;
			if (match("toggleResources")) setRightPanel(rightPanel === "resources" ? null : "resources");
			else if (match("toggleWorkspace")) setRightPanel(rightPanel === "workspace" ? null : "workspace");
			else if (match("toggleArtifacts")) setRightPanel(rightPanel === "artifacts" ? null : "artifacts");
			else if (match("toggleRepl")) setRightPanel(rightPanel === "repl" ? null : "repl");
			else if (match("toggleSubagents")) setRightPanel(rightPanel === "subagents" ? null : "subagents");
			else if (rightPanel && match("closePanel")) {
				setRightPanel(null);
				focusChatComposer();
			} else if (rightPanel && match("focusPanel")) {
				document.querySelector<HTMLElement>("[data-fleet-panel-focus]")?.focus({ preventScroll: true });
			} else if (match("focusChat")) focusChatComposer();
			else handled = false;

			if (handled) {
				event.preventDefault();
				event.stopPropagation();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [rightPanel, setRightPanel]);
}
