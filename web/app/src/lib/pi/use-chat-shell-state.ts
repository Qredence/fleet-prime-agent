import type { RightPanel, ThemePreference } from "@prime-agent/web-design/lib/canvas-utils";
import {
	applyThemePreference,
	clampResourceCanvasWidth,
	getResourceCanvasInitialWidth,
	readStoredResourceCanvasWidth,
	readStoredThemePreference,
	storeResourceCanvasWidth,
	storeThemePreference,
} from "@prime-agent/web-design/lib/canvas-utils";
import { startHorizontalResize } from "@prime-agent/web-design/lib/horizontal-resize";
import {
	availableThinkingLevels,
	clampThinkingLevel,
	toModelOption,
	toModelSelection,
} from "@prime-agent/web-design/lib/pi/chat-helpers";
import { resolveWorkspacePanelTarget } from "@prime-agent/web-design/lib/workspace-path-nav";
import type {
	ChatModelsResponse,
	ChatSessionMetadata,
	ChatThinkingLevel,
} from "@prime-agent/web-protocol/chat-protocol";
import type { OpenPanelAction } from "@prime-agent/web-protocol/fleet-contract";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ChatShellStorage = {
	sessionMetadata: ChatSessionMetadata;
	setSessionMetadata: (metadata: ChatSessionMetadata) => void;
};

export function useChatShellState(modelsData: ChatModelsResponse | undefined, storage: ChatShellStorage) {
	const { sessionMetadata: storedSessionMetadata, setSessionMetadata: setStoredSessionMetadata } = storage;

	const models = useMemo(() => modelsData?.models.map(toModelOption) ?? [], [modelsData]);
	const [modelKey, setModelKey] = useState<string | undefined>();
	const [thinkingLevel, setThinkingLevelState] = useState<ChatThinkingLevel | undefined>();
	const [rightPanel, setRightPanelState] = useState<RightPanel>(null);
	const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
	const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | null>(null);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [themePreference, setThemePreference] = useState<ThemePreference>(() => readStoredThemePreference());
	const [resourceCanvasWidth, setResourceCanvasWidth] = useState(() => readStoredResourceCanvasWidth());

	useEffect(() => {
		if (models.length === 0) return;

		const preferredKey = modelsData?.selectedModelKey ?? models[0].id;

		if (!modelKey) {
			setModelKey(preferredKey);
			return;
		}

		const selected = models.find((model) => model.id === modelKey);
		if (!selected || selected.available === false) {
			setModelKey(preferredKey);
		}
	}, [models, modelKey, modelsData]);

	useEffect(() => {
		const selected = models.find((model) => model.id === modelKey);
		if (!selected) return;
		const available = availableThinkingLevels(selected);
		setThinkingLevelState((current) => clampThinkingLevel(current ?? modelsData?.defaultThinkingLevel, available));
	}, [models, modelKey, modelsData?.defaultThinkingLevel]);

	useEffect(() => {
		applyThemePreference(themePreference);

		if (themePreference !== "system") return;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => applyThemePreference("system");
		media.addEventListener("change", handleChange);
		return () => media.removeEventListener("change", handleChange);
	}, [themePreference]);

	const prevRightPanelRef = useRef<RightPanel>(null);

	useEffect(() => {
		const prevRightPanel = prevRightPanelRef.current;
		prevRightPanelRef.current = rightPanel;

		if (!rightPanel || prevRightPanel !== null) return;

		const initialWidth = getResourceCanvasInitialWidth();
		setResourceCanvasWidth(initialWidth);
		storeResourceCanvasWidth(initialWidth);
	}, [rightPanel]);

	useEffect(() => {
		if (rightPanel !== null) return;
		setSelectedWorkspacePath(null);
	}, [rightPanel]);

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

	const setRightPanel = useCallback((panel: RightPanel) => {
		setRightPanelState(panel);

		if (panel === null) {
			setSelectedArtifactId(null);
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
		(artifactId: string) => {
			setSelectedArtifactId(artifactId);
			setRightPanel("artifacts");
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
			const isLocationPanel = action.panel === "workspace" || action.panel === "artifacts";
			setRightPanel(action.panel);
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
		thinkingLevel ?? modelsData?.defaultThinkingLevel,
		availableThinkingLevels(selectedModel),
	);
	const setThinkingLevel = useCallback(
		(level: ChatThinkingLevel) => {
			const selected = models.find((model) => model.id === modelKey);
			setThinkingLevelState(clampThinkingLevel(level, availableThinkingLevels(selected)));
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
		handleThemePreferenceChange,
		initialSessionMetadata: storedSessionMetadata,
		modelKey,
		modelSelection,
		models,
		openWorkspacePath,
		openPanelAction,
		persistSession,
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
