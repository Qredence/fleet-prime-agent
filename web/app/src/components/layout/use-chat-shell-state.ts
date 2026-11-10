import type {
	ChatModelsResponse,
	ChatSessionMetadata,
	ChatThinkingLevel,
} from "@prime-agent/web-protocol/chat-protocol";
import type { OpenPanelAction } from "@prime-agent/web-protocol/fleet-contract";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	availableThinkingLevels,
	clampThinkingLevel,
	toModelOption,
	toModelSelection,
} from "@/components/chat/chat-helpers";
import type { RightPanel, ThemePreference } from "@/components/layout/canvas-utils";
import {
	applyThemePreference,
	clampResourceCanvasWidth,
	getResourceCanvasInitialWidth,
	readStoredResourceCanvasWidth,
	readStoredThemePreference,
	storeResourceCanvasWidth,
	storeThemePreference,
} from "@/components/layout/canvas-utils";
import { resolveWorkspacePanelTarget } from "@/components/workspace/workspace-path-nav";
import { startHorizontalResize } from "@/lib/horizontal-resize";
import { readStoredValue, writeStoredValue } from "@/lib/safe-storage";

const MODEL_SELECTION_KEY = "fleet:chat:model-selection";

export type ChatShellStorage = {
	sessionMetadata: ChatSessionMetadata;
	setSessionMetadata: (metadata: ChatSessionMetadata) => void;
};

export type ArtifactOpenTarget = "artifacts" | "repl" | "dashboards";

/**
 * Manages chat-shell state, including model selection, panels, navigation, themes, sessions, and resource-canvas sizing.
 *
 * @param modelsData - Available models and their server-provided selection and default thinking level
 * @param storage - Storage interface for session metadata
 * @returns Chat-shell state, resolved model information, navigation actions, panel controls, and event handlers
 */
export function useChatShellState(modelsData: ChatModelsResponse | undefined, storage: ChatShellStorage) {
	const { sessionMetadata: storedSessionMetadata, setSessionMetadata: setStoredSessionMetadata } = storage;

	const models = useMemo(() => modelsData?.models.map(toModelOption) ?? [], [modelsData]);
	const [storedModelKey, setStoredModelKey] = useState<string | undefined>(
		() => readStoredValue(MODEL_SELECTION_KEY, "session") ?? undefined,
	);
	const [thinkingLevelOverride, setThinkingLevelOverride] = useState<ChatThinkingLevel | undefined>();
	const [rightPanel, setRightPanelState] = useState<RightPanel>(null);
	const lastRightPanelRef = useRef<Exclude<RightPanel, null>>("workspace");
	const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
	const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [themePreference, setThemePreference] = useState<ThemePreference>(() => readStoredThemePreference());
	const [resourceCanvasWidth, setResourceCanvasWidth] = useState(() => readStoredResourceCanvasWidth());

	const modelKey = useMemo(() => {
		if (!modelsData || models.length === 0) return undefined;
		const preferredKey = modelsData.selectedModelKey ?? models[0].id;
		if (!storedModelKey) return preferredKey;
		const selected = models.find((model) => model.id === storedModelKey);
		if (!selected || selected.available === false) return preferredKey;
		return storedModelKey;
	}, [models, modelsData, storedModelKey]);

	useEffect(() => {
		if (modelKey) writeStoredValue(MODEL_SELECTION_KEY, modelKey, "session");
	}, [modelKey]);

	const setModelKey = useCallback((key: string | undefined) => {
		setStoredModelKey(key);
		if (key) writeStoredValue(MODEL_SELECTION_KEY, key, "session");
	}, []);

	useEffect(() => {
		applyThemePreference(themePreference);

		if (themePreference !== "system") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => applyThemePreference("system");
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, [themePreference]);

	useEffect(() => {
		if (!rightPanel) return;

		const handleViewportResize = () => {
			setResourceCanvasWidth((currentWidth) => {
				const nextWidth = clampResourceCanvasWidth(currentWidth);
				storeResourceCanvasWidth(nextWidth);
				return nextWidth;
			});
		};

		window.addEventListener("resize", handleViewportResize);
		return () => {
			window.removeEventListener("resize", handleViewportResize);
		};
	}, [rightPanel]);

	const handleThemePreferenceChange = useCallback((preference: ThemePreference) => {
		setThemePreference(preference);
		storeThemePreference(preference);
		applyThemePreference(preference);
	}, []);

	const handleResourceCanvasWidthChange = useCallback((nextWidth: number) => {
		const clamped = clampResourceCanvasWidth(nextWidth);
		setResourceCanvasWidth(clamped);
		storeResourceCanvasWidth(clamped);
	}, []);

	const handleResourceCanvasResizeStart = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			const startWidth = resourceCanvasWidth;

			startHorizontalResize({
				event,
				startWidth,
				getNextWidth: (clientX, startX, width) => clampResourceCanvasWidth(width - (clientX - startX)),
				onWidthChange: (nextWidth) => {
					setResourceCanvasWidth(nextWidth);
					storeResourceCanvasWidth(nextWidth);
				},
			});
		},
		[resourceCanvasWidth],
	);

	const reopenRightPanel = useCallback(() => {
		setRightPanelState(lastRightPanelRef.current);
	}, []);

	const setRightPanel = useCallback((panel: RightPanel) => {
		let openingFromClosed = false;
		setRightPanelState((current) => {
			if (panel !== null && current === null) openingFromClosed = true;
			return panel;
		});
		if (openingFromClosed) {
			const initialWidth = getResourceCanvasInitialWidth();
			setResourceCanvasWidth(initialWidth);
			storeResourceCanvasWidth(initialWidth);
		}
		if (panel !== null) lastRightPanelRef.current = panel;
		if (panel === null) {
			setSelectedArtifactId(null);
			setSelectedWorkspacePath(null);
			return;
		}

		setSelectedWorkspacePath((current) => {
			if (!current) return current;
			const target = resolveWorkspacePanelTarget(current);
			if (!target || target.panel === panel) return current;
			return null;
		});
	}, []);

	const openArtifact = useCallback(
		(artifactId: string, target: ArtifactOpenTarget = "artifacts") => {
			setSelectedArtifactId(artifactId);
			setRightPanel(target);
		},
		[setRightPanel],
	);

	const openWorkspacePath = useCallback(
		(rawPath: string) => {
			const target = resolveWorkspacePanelTarget(rawPath);
			if (!target) return;

			setRightPanel(target.panel);
			setSelectedWorkspacePath(target.path);
		},
		[setRightPanel],
	);

	const openPanelAction = useCallback(
		(action: OpenPanelAction) => {
			const panel = action.panel === "artifacts" && action.relativePath ? "workspace" : action.panel;
			const isLocationPanel = panel === "workspace" || panel === "artifacts";
			setRightPanel(panel);
			setSelectedWorkspacePath(isLocationPanel ? (action.relativePath ?? null) : null);
			if (action.focus) {
				window.requestAnimationFrame(() => {
					document.querySelector<HTMLElement>("[data-fleet-panel-focus]")?.focus({ preventScroll: true });
				});
			}
		},
		[setRightPanel],
	);

	const persistSession = useCallback(
		(metadata: ChatSessionMetadata) => {
			setStoredSessionMetadata(metadata);
		},
		[setStoredSessionMetadata],
	);

	const selectedModel = models.find((model) => model.id === modelKey);
	const resolvedThinkingLevel = clampThinkingLevel(
		thinkingLevelOverride ?? modelsData?.defaultThinkingLevel,
		availableThinkingLevels(selectedModel),
	);
	const setThinkingLevel = useCallback(
		(level: ChatThinkingLevel) => {
			const selected = models.find((model) => model.id === modelKey);
			setThinkingLevelOverride(clampThinkingLevel(level, availableThinkingLevels(selected)));
		},
		[modelKey, models],
	);
	const modelSelection = useMemo(
		() => toModelSelection(selectedModel, resolvedThinkingLevel),
		[resolvedThinkingLevel, selectedModel],
	);

	return {
		commandPaletteOpen,
		handleResourceCanvasResizeStart,
		handleResourceCanvasWidthChange,
		handleThemePreferenceChange,
		initialSessionMetadata: storedSessionMetadata,
		modelKey,
		modelSelection,
		models,
		openWorkspacePath,
		openPanelAction,
		persistSession,
		reopenRightPanel,
		resourceCanvasWidth,
		rightPanel,
		selectedArtifactId,
		selectedWorkspacePath,
		setCommandPaletteOpen,
		setModelKey,
		setRightPanel,
		openArtifact,
		setSelectedWorkspacePath,
		setThinkingLevel,
		themePreference,
		thinkingLevel: resolvedThinkingLevel,
	};
}
