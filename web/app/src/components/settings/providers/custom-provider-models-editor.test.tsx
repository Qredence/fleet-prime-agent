import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CUSTOM_PROVIDER_MODELS_PAGE_SIZE, CustomProviderModelsEditor } from "./custom-provider-models-editor";

afterEach(cleanup);

it("filters models by search and loads more progressively", () => {
	const modelIds = Array.from({ length: CUSTOM_PROVIDER_MODELS_PAGE_SIZE + 5 }, (_, index) => `model-${index + 1}`);
	const onChange = vi.fn();
	render(<CustomProviderModelsEditor attemptedSave={false} modelIds={modelIds} onChange={onChange} />);

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
	render(<CustomProviderModelsEditor attemptedSave={false} modelIds={["alpha"]} onChange={onChange} />);

	fireEvent.change(screen.getByLabelText("Add model id"), { target: { value: "beta" } });
	fireEvent.click(screen.getByRole("button", { name: "Add" }));
	expect(onChange).toHaveBeenCalledWith(["alpha", "beta"]);

	onChange.mockClear();
	fireEvent.click(screen.getByRole("button", { name: "Remove model alpha" }));
	expect(onChange).toHaveBeenCalledWith([]);
});
