import type { ChatSettingsResponse } from "@prime-agent/web-protocol/chat-protocol";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
	ChatPanelDataContextValue,
	SettingsActionsContextValue,
	WorkspaceTreeContextValue,
} from "@/components/layout/right-panel-context";
import { RightPanelProvider } from "@/components/layout/right-panel-context";
import type { ModelDefaultsSection } from "@/components/settings/providers/model-defaults-section";
import type { useModelDefaultsForm } from "@/components/settings/providers/use-model-defaults-form";
import { SettingsDialog } from "@/components/settings/settings-dialog";

const state = vi.hoisted(() => ({ dirty: false }));
type ModelDefaultsFormArgs = Parameters<typeof useModelDefaultsForm>[0];
type ModelDefaultsSectionProps = Parameters<typeof ModelDefaultsSection>[0];

vi.mock("@/components/settings/providers/use-model-defaults-form", () => ({
	useModelDefaultsForm: ({ setDraft }: ModelDefaultsFormArgs) => ({
		modelFilter: "",
		setModelFilter: () => {},
		modelOptions: [],
		modelDirty: state.dirty,
		addModels: () => {
			state.dirty = true;
			setDraft((current) => (current ? { ...current, enabledModels: ["local"] } : current));
		},
		removeModel: () => {},
		setDefaultModel: () => {},
		discoverProvider: async () => {},
		discoveringProviderId: null,
		commitModelSettings: async () => true,
		revertModelDraft: () => {
			state.dirty = false;
			setDraft((current) => (current ? { ...current, enabledModels: ["baseline"] } : current));
		},
		resetCommittedModelBaseline: () => {},
	}),
}));

vi.mock("@/components/settings/use-resources-form", () => ({
	useResourcesForm: () => ({
		packageRows: [],
		packageError: undefined,
		resourceDirty: false,
		handlePackageRowsChange: () => {},
		revertResourceDraft: () => {},
	}),
}));

vi.mock("@/components/settings/providers/model-defaults-section", () => ({
	ModelDefaultsSection: ({ draft, modelDirty, onAddModels, onRevert }: ModelDefaultsSectionProps) => (
		<section>
			<output data-testid="enabled-models">{draft?.enabledModels?.join(",") ?? ""}</output>
			<output data-testid="model-dirty">{String(modelDirty)}</output>
			<button type="button" onClick={() => onAddModels([])}>
				Make local edit
			</button>
			<button type="button" onClick={onRevert}>
				Clear local edit
			</button>
		</section>
	),
}));

afterEach(() => {
	cleanup();
	state.dirty = false;
});

function settings(enabledModels: Array<string>): ChatSettingsResponse {
	return {
		diagnostics: [],
		effective: {
			compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 100 },
			enableSkillCommands: true,
			enabledModels,
			extensions: [],
			followUpMode: "one-at-a-time",
			packages: [],
			prompts: [],
			retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000 },
			skills: [],
			steeringMode: "one-at-a-time",
			themes: [],
			transport: "auto",
		},
		project: {},
		projectPath: "/tmp/settings",
		updateImpact: { newSessionRecommended: false, resourceReloadRequired: false },
	};
}

it("applies settings that arrived during a dirty draft after the local edit is cleared", async () => {
	const initialSettings = settings(["baseline"]);
	const chatPanelData = { models: [], resources: null } as unknown as ChatPanelDataContextValue;
	const workspaceTree = {} as unknown as WorkspaceTreeContextValue;
	const settingsActions = (currentSettings: ChatSettingsResponse): SettingsActionsContextValue => ({
		onThemePreferenceChange: () => {},
		saveSettings: async () => currentSettings,
		settings: currentSettings,
		settingsError: null,
		settingsLoading: false,
		themePreference: "system",
	});
	const view = render(
		<RightPanelProvider
			chatPanelData={chatPanelData}
			workspaceTree={workspaceTree}
			settingsActions={settingsActions(initialSettings)}
		>
			<SettingsDialog open onOpenChange={() => {}} initialTab="llm-models" />
		</RightPanelProvider>,
	);

	await waitFor(() => expect(screen.getByTestId("enabled-models").textContent).toBe("baseline"));
	fireEvent.click(screen.getByRole("button", { name: "Make local edit" }));
	await waitFor(() => expect(screen.getByTestId("model-dirty").textContent).toBe("true"));

	view.rerender(
		<RightPanelProvider
			chatPanelData={chatPanelData}
			workspaceTree={workspaceTree}
			settingsActions={settingsActions(settings(["remote"]))}
		>
			<SettingsDialog open onOpenChange={() => {}} initialTab="llm-models" />
		</RightPanelProvider>,
	);
	await waitFor(() => expect(screen.getByTestId("enabled-models").textContent).toBe("local"));

	fireEvent.click(screen.getByRole("button", { name: "Clear local edit" }));
	await waitFor(() => expect(screen.getByTestId("enabled-models").textContent).toBe("remote"));
});
