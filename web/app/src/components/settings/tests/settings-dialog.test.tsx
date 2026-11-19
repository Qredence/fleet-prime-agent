import type { ChatSettingsResponse } from "@prime-agent/web-protocol/chat-protocol";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
	ChatPanelDataContextValue,
	SettingsActionsContextValue,
	WorkspaceTreeContextValue,
} from "@/components/layout/right-panel-context";
import { RightPanelProvider } from "@/components/layout/right-panel-context";
import type { ModelDefaultsSection } from "@/components/settings/providers/model-defaults-section";
import type { useModelDefaultsForm } from "@/hooks/settings/use-model-defaults-form";
import { useResourcesForm } from "@/hooks/settings/use-resources-form";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Button } from "@/components/ui/button";

vi.mock("@/lib/dashboards/dashboard-client", () => ({
	fetchDashboardStatus: vi.fn(async () => {
		throw new Error("Dashboard service unavailable in fixture");
	}),
	saveDashboardKey: vi.fn(),
	saveDashboardSettings: vi.fn(),
}));

const state = vi.hoisted(() => ({ dirty: false }));
type ModelDefaultsFormArgs = Parameters<typeof useModelDefaultsForm>[0];
type ModelDefaultsSectionProps = Parameters<typeof ModelDefaultsSection>[0];

vi.mock("@/hooks/settings/use-model-defaults-form", () => ({
	useModelDefaultsForm: ({ setDraft, settings }: ModelDefaultsFormArgs) => ({
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
		// Match production: revert to the latest settings.effective, including
		// remote updates that arrived while the draft was dirty.
		revertModelDraft: () => {
			state.dirty = false;
			if (!settings) return;
			setDraft((current) => (current ? { ...current, enabledModels: settings.effective.enabledModels } : current));
		},
		resetCommittedModelBaseline: () => {},
	}),
}));

vi.mock("@/components/settings/providers/model-defaults-section", () => ({
	ModelDefaultsSection: ({ draft, modelDirty, onAddModels, onRevert }: ModelDefaultsSectionProps) => (
		<section>
			<output data-testid="enabled-models">{draft?.enabledModels?.join(",") ?? ""}</output>
			<output data-testid="model-dirty">{String(modelDirty)}</output>
			<Button type="button" onClick={() => onAddModels([])}>
				Make local edit
			</Button>
			<Button type="button" onClick={onRevert}>
				Clear local edit
			</Button>
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
	const modelsDialog = (currentSettings: ChatSettingsResponse) => (
		<RightPanelProvider
			chatPanelData={chatPanelData}
			workspaceTree={workspaceTree}
			settingsActions={settingsActions(currentSettings)}
		>
			<SettingsDialog open onOpenChange={() => {}} initialTab="llm-models" />
		</RightPanelProvider>
	);
	const view = render(modelsDialog(initialSettings));

	await waitFor(() => expect(screen.getByTestId("enabled-models").textContent).toBe("baseline"));
	view.rerender(modelsDialog(settings(["fresh"])));
	await waitFor(() => expect(screen.getByTestId("enabled-models").textContent).toBe("fresh"));

	fireEvent.click(screen.getByRole("button", { name: "Make local edit" }));
	await waitFor(() => expect(screen.getByTestId("model-dirty").textContent).toBe("true"));

	view.rerender(modelsDialog(settings(["remote"])));
	await waitFor(() => expect(screen.getByTestId("enabled-models").textContent).toBe("local"));

	fireEvent.click(screen.getByRole("button", { name: "Clear local edit" }));
	await waitFor(() => expect(screen.getByTestId("enabled-models").textContent).toBe("remote"));
});

function renderSettingsDialog(onOpenChange = vi.fn(), saveSettings = vi.fn(async () => settings(["baseline"]))) {
	const value = settings(["baseline"]);
	return {
		onOpenChange,
		saveSettings,
		...render(
			<RightPanelProvider
				chatPanelData={{ models: [], resources: null } as unknown as ChatPanelDataContextValue}
				workspaceTree={{} as WorkspaceTreeContextValue}
				settingsActions={{
					onThemePreferenceChange: vi.fn(),
					saveSettings,
					settings: value,
					settingsError: null,
					settingsLoading: false,
					themePreference: "system",
				}}
			>
				<SettingsDialog open onOpenChange={onOpenChange} />
			</RightPanelProvider>,
		),
	};
}

it("searches individual settings, retains edits across sections, and guards discard", async () => {
	const { onOpenChange } = renderSettingsDialog();
	await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Appearance" })));
	fireEvent.change(screen.getByLabelText("Search settings"), { target: { value: "Reserved context" } });
	fireEvent.click(screen.getByRole("button", { name: "Reserved context tokens" }));
	const reserve = await screen.findByLabelText("Reserved context tokens");
	await waitFor(() => expect(document.activeElement).toBe(reserve));
	fireEvent.change(reserve, { target: { value: "123" } });
	fireEvent.click(screen.getByRole("button", { name: "Chat" }));
	fireEvent.click(screen.getByRole("button", { name: "Context & compaction · Unsaved" }));
	expect((screen.getByLabelText("Reserved context tokens") as HTMLInputElement).value).toBe("123");
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	await screen.findByText("Discard unsaved changes?");
	expect(onOpenChange).not.toHaveBeenCalledWith(false);
	fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
	await screen.findByRole("button", { name: "Cancel changes" });
	fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

it("saves only the visible runtime section at the selected explicit scope", async () => {
	const { saveSettings } = renderSettingsDialog();
	fireEvent.click(screen.getByRole("button", { name: "Context & compaction" }));
	fireEvent.change(await screen.findByLabelText("Reserved context tokens"), { target: { value: "321" } });
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() =>
		expect(saveSettings).toHaveBeenCalledWith(
			{ compaction: { enabled: true, reserveTokens: 321, keepRecentTokens: 100 } },
			"project",
		),
	);
});

it("tracks an unadded resource path and clears it with section Cancel", async () => {
	const { onOpenChange } = renderSettingsDialog();
	fireEvent.click(screen.getByRole("button", { name: "Prompt templates" }));
	const path = await screen.findByLabelText("Add prompt");
	fireEvent.change(path, { target: { value: "./pending-prompt" } });
	await screen.findByRole("button", { name: "Prompt templates · Unsaved" });
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	await screen.findByText("Discard unsaved changes?");
	expect(onOpenChange).not.toHaveBeenCalledWith(false);
	fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
	fireEvent.click(await screen.findByRole("button", { name: "Cancel changes" }));
	await waitFor(() => expect((path as HTMLInputElement).value).toBe(""));
	expect(screen.queryByRole("button", { name: "Prompt templates · Unsaved" })).toBeNull();
});

it("keeps Cancel available for invalid package JSON", async () => {
	renderSettingsDialog();
	fireEvent.click(screen.getByRole("button", { name: "Extensions & packages" }));
	const input = await screen.findByLabelText("Add package");
	fireEvent.change(input, { target: { value: "{invalid" } });
	fireEvent.keyDown(input, { key: "Enter" });
	await screen.findByRole("alert");
	const cancel = screen.getByRole("button", { name: "Cancel changes" }) as HTMLButtonElement;
	expect(cancel.disabled).toBe(false);
	expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(cancel);
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("does not offer discard while a runtime save and another section draft coexist", async () => {
	let finish!: (value: ChatSettingsResponse) => void;
	const save = vi.fn(
		() =>
			new Promise<ChatSettingsResponse>((resolve) => {
				finish = resolve;
			}),
	);
	const { onOpenChange } = renderSettingsDialog(vi.fn(), save);
	fireEvent.click(screen.getByRole("button", { name: "Prompt templates" }));
	fireEvent.change(await screen.findByLabelText("Add prompt"), { target: { value: "pending" } });
	await screen.findByRole("button", { name: "Prompt templates · Unsaved" });
	fireEvent.click(screen.getByRole("button", { name: "Context & compaction" }));
	fireEvent.change(await screen.findByLabelText("Reserved context tokens"), { target: { value: "321" } });
	fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
	await waitFor(() => expect(save).toHaveBeenCalled());
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	await waitFor(() =>
		expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true),
	);
	expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
	expect(onOpenChange).not.toHaveBeenCalledWith(false);
	await act(async () => {
		finish(settings(["baseline"]));
	});
});

it.each([
	["Thesys API key", "Thesys API key"],
	["Daytona API key", "Daytona API key"],
	["Region / target", "Region / target"],
])("focuses the actual credential control for %s", async (query, label) => {
	renderSettingsDialog();
	await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Appearance" })));
	fireEvent.change(screen.getByLabelText("Search settings"), { target: { value: query } });
	fireEvent.click(screen.getByRole("button", { name: query }));
	const input = await screen.findByLabelText(label);
	await waitFor(() => expect(document.activeElement).toBe(input));
});

it("refreshes clean saved package rows but preserves unsaved package text", () => {
	const withPackages = (packages: string[]): ChatSettingsResponse => {
		const value = settings([]);
		return { ...value, effective: { ...value.effective, packages } };
	};
	const initial = withPackages(["npm:initial"]);
	const saved = withPackages(["npm:saved"]);
	const remote = withPackages(["npm:remote"]);
	const updateDraft = vi.fn();
	const { result, rerender } = renderHook(
		(value: ChatSettingsResponse) => useResourcesForm({ draft: value.effective, settings: value, updateDraft }),
		{ initialProps: initial },
	);
	act(() => result.current.handlePackageRowsChange(["npm:saved"]));
	rerender(saved);
	expect(result.current.packageRows).toEqual(["npm:saved"]);
	expect(result.current.resourceDirty).toBe(false);
	rerender(remote);
	expect(result.current.packageRows).toEqual(["npm:remote"]);
	expect(result.current.resourceDirty).toBe(false);
	act(() => result.current.handlePackageRowsChange(["npm:local"]));
	rerender(initial);
	expect(result.current.packageRows).toEqual(["npm:local"]);
	expect(result.current.resourceDirty).toBe(true);
});
