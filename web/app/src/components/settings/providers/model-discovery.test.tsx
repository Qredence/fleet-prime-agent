import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AddModelsDialog } from "./add-models-dialog";
import { useModelDefaultsForm } from "./use-model-defaults-form";
import { useProviderCredentialsController } from "./use-provider-credentials-controller";

afterEach(cleanup);
const provider = { id: "command", name: "Command", isConfigured: true, envVarName: "COMMAND_API_KEY" };
const model = (id: string) => ({ id: `command/${id}`, modelId: id, provider: "command", name: id, available: true });

it("orders Custom provider first and keeps provider search functional", () => {
	const { result } = renderHook(() =>
		useProviderCredentialsController({
			providers: [
				{ ...provider, isConfigured: false },
				{ ...provider, id: "alpha", name: "Alpha", envVarName: "ALPHA_API_KEY", isConfigured: false },
			],
		}),
	);
	expect(result.current.filteredPickerAvailable.map((p) => p.name)).toEqual(["Custom provider", "Alpha", "Command"]);
	act(() => result.current.setAddPickerQuery("command"));
	expect(result.current.filteredPickerAvailable.map((p) => p.id)).toEqual(["command"]);
});

it("uses live IDs authoritatively, preserving enabled models and metadata, and retains them after a failed refresh", async () => {
	const discover = vi.fn().mockResolvedValue([model("new")]);
	const { result } = renderHook(() =>
		useModelDefaultsForm({
			draft: {
				enabledModels: ["command/enabled"],
				compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 100 },
				enableSkillCommands: true,
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
			setDraft: vi.fn(),
			updateDraft: vi.fn(),
			settings: null,
			providers: [provider],
			models: [{ ...model("new"), reasoning: true }, model("old"), model("enabled")],
			onDiscoverModels: discover,
			saveSettings: vi.fn(),
			setSavingSection: vi.fn(),
		}),
	);
	await act(() => result.current.discoverProvider("command"));
	expect(result.current.modelOptions.map((m) => m.modelId).sort()).toEqual(["enabled", "new"]);
	expect(result.current.modelOptions.find((m) => m.modelId === "new")?.reasoning).toBe(true);
	discover.mockResolvedValueOnce([]);
	await act(() => result.current.discoverProvider("command"));
	expect(result.current.modelOptions.map((m) => m.modelId)).toEqual(["enabled"]);
	discover.mockRejectedValueOnce(new Error("failure"));
	await act(async () => {
		await expect(result.current.discoverProvider("command")).rejects.toThrow();
	});
	expect(result.current.modelOptions.map((m) => m.modelId)).toEqual(["enabled"]);
});

it("discovers on opening, deduplicates and caches for 60s, and exposes refresh failures", async () => {
	const discover = vi.fn().mockResolvedValue(undefined);
	const props = {
		configuredProviderIds: new Set(["command"]),
		discoverableProviderIds: new Set(["command"]),
		discoveringProviderId: null,
		enabledModels: [],
		modelOptions: [model("new")],
		onAddModels: vi.fn(),
		onDiscoverProvider: discover,
		onOpenChange: vi.fn(),
		open: true,
	};
	const view = render(<AddModelsDialog {...props} />);
	await waitFor(() => expect(discover).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(screen.getByRole("button", { name: /Refresh/ }).hasAttribute("disabled")).toBe(false));
	view.rerender(<AddModelsDialog {...props} open={false} />);
	view.rerender(<AddModelsDialog {...props} />);
	expect(discover).toHaveBeenCalledTimes(1);
	discover.mockRejectedValueOnce(new Error("failed"));
	fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
	await waitFor(() => expect(screen.getByText(/Refresh failed/)).toBeTruthy());
	expect(screen.getAllByText("new")).toBeTruthy();
	const now = Date.now();
	const clock = vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
	view.rerender(<AddModelsDialog {...props} open={false} />);
	view.rerender(<AddModelsDialog {...props} />);
	await waitFor(() => expect(discover).toHaveBeenCalledTimes(3));
	clock.mockRestore();
});
