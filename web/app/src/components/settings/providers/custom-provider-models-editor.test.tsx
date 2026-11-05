import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CUSTOM_PROVIDER_MODELS_PAGE_SIZE, CustomProviderModelsEditor } from "./custom-provider-models-editor";
import { ProviderCredentialsSection } from "./provider-credentials-section";

afterEach(cleanup);

it("filters models by search and loads more progressively", () => {
	const modelIds = Array.from({ length: CUSTOM_PROVIDER_MODELS_PAGE_SIZE + 5 }, (_, index) => `model-${index + 1}`);
	const onChange = vi.fn();
	render(
		<CustomProviderModelsEditor
			attemptedSave={false}
			modelIds={modelIds}
			newModelId=""
			onChange={onChange}
			onNewModelIdChange={vi.fn()}
		/>,
	);

	expect(screen.getByText(`model-${CUSTOM_PROVIDER_MODELS_PAGE_SIZE}`)).toBeTruthy();
	expect(screen.queryByText(`model-${CUSTOM_PROVIDER_MODELS_PAGE_SIZE + 1}`)).toBeNull();

	fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
	expect(screen.getByText(`model-${CUSTOM_PROVIDER_MODELS_PAGE_SIZE + 1}`)).toBeTruthy();

	fireEvent.change(screen.getByLabelText("Search model ids"), { target: { value: "model-9" } });
	expect(screen.getByText("model-9")).toBeTruthy();
	expect(screen.queryByText("model-1")).toBeNull();
});

it("adds and removes model ids", () => {
	const onChange = vi.fn();
	render(<EditorWithDraft modelIds={["alpha"]} onChange={onChange} />);

	fireEvent.change(screen.getByLabelText("Add model id"), { target: { value: "beta" } });
	fireEvent.click(screen.getByRole("button", { name: "Add" }));
	expect(onChange).toHaveBeenCalledWith(["alpha", "beta"]);

	onChange.mockClear();
	fireEvent.click(screen.getByRole("button", { name: "Remove model alpha" }));
	expect(onChange).toHaveBeenCalledWith([]);
});

function EditorWithDraft({ modelIds, onChange }: { modelIds: Array<string>; onChange: (ids: Array<string>) => void }) {
	const [draft, setDraft] = useState("");
	return (
		<CustomProviderModelsEditor
			attemptedSave={false}
			modelIds={modelIds}
			newModelId={draft}
			onChange={onChange}
			onNewModelIdChange={setDraft}
		/>
	);
}

it("only adds on Enter after IME composition has ended", () => {
	const onChange = vi.fn();
	render(<EditorWithDraft modelIds={["alpha"]} onChange={onChange} />);
	const input = screen.getByLabelText("Add model id");
	fireEvent.change(input, { target: { value: "beta" } });
	for (const flags of [
		{ isComposing: true, keyCode: 13 },
		{ isComposing: false, keyCode: 229 },
	]) {
		const event = createEvent.keyDown(input, { key: "Enter", ...flags, cancelable: true });
		fireEvent(input, event);
		expect(event.defaultPrevented).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
		expect((input as HTMLInputElement).value).toBe("beta");
	}
	const enter = createEvent.keyDown(input, { key: "Enter", keyCode: 13, cancelable: true });
	fireEvent(input, enter);
	expect(enter.defaultPrevented).toBe(true);
	expect(onChange).toHaveBeenCalledWith(["alpha", "beta"]);
});

it.each([false, true])("saves a draft for a custom provider (configured: %s)", async (configured) => {
	const onUpdateProvider = vi.fn().mockResolvedValue({});
	const provider = {
		id: "custom+example",
		name: "Example",
		displayName: "Example",
		isConfigured: true,
		envVarName: "EXAMPLE_KEY",
		baseUrl: "https://example.com",
		modelIds: ["alpha"],
	};
	render(
		<ProviderCredentialsSection
			isLoading={false}
			isPending={false}
			providers={configured ? [provider] : []}
			onUpdateProvider={onUpdateProvider}
		/>,
	);
	if (configured) {
		fireEvent.click(screen.getByRole("button", { name: "Update" }));
	} else {
		fireEvent.click(screen.getAllByRole("button", { name: "Add provider" })[0]);
		fireEvent.click(screen.getByRole("button", { name: /Custom provider/ }));
		fireEvent.change(screen.getByLabelText("Provider name"), { target: { value: "Example" } });
		fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://example.com" } });
	}
	fireEvent.change(screen.getByLabelText("API key"), { target: { value: "key" } });
	fireEvent.change(screen.getByLabelText("Add model id"), { target: { value: "  beta  " } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(onUpdateProvider).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: configured ? "custom+example" : "custom",
				models: configured ? ["alpha", "beta"] : ["beta"],
			}),
		),
	);
	await waitFor(() => expect(screen.queryByLabelText("Add model id")).toBeNull());
});

it("deduplicates a draft and clears it when switching editors", async () => {
	const onUpdateProvider = vi.fn().mockResolvedValue({});
	const provider = {
		id: "custom+example",
		name: "Example",
		displayName: "Example",
		isConfigured: true,
		envVarName: "EXAMPLE_KEY",
		baseUrl: "https://example.com",
		modelIds: ["alpha"],
	};
	render(
		<ProviderCredentialsSection
			isLoading={false}
			isPending={false}
			providers={[provider]}
			onUpdateProvider={onUpdateProvider}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Update" }));
	const input = screen.getByLabelText("Add model id") as HTMLInputElement;
	expect(input.value).toBe("");
	fireEvent.change(input, { target: { value: "unsaved" } });
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	fireEvent.click(screen.getByRole("button", { name: "Update" }));
	expect((screen.getByLabelText("Add model id") as HTMLInputElement).value).toBe("");
	fireEvent.change(screen.getByLabelText("API key"), { target: { value: "key" } });
	fireEvent.change(screen.getByLabelText("Add model id"), { target: { value: " alpha " } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() => expect(onUpdateProvider).toHaveBeenCalledWith(expect.objectContaining({ models: ["alpha"] })));
});
