import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerIntentSection } from "@/components/settings/composer-intent-section";
import { SettingsDraftProvider } from "@/components/settings/settings-draft-provider";
import { useSettingsDraft, useSettingsDraftState } from "@/components/settings/use-settings-draft-state";

function DraftState() {
	const { dirtySections, busy } = useSettingsDraftState();
	return <output data-testid="draft-state">{JSON.stringify({ dirtySections, busy })}</output>;
}

function FormStatus({ dirty, busy = false }: { dirty: boolean; busy?: boolean }) {
	useSettingsDraft("services", { dirty, busy });
	return null;
}

describe("settings draft lifecycle", () => {
	it("aggregates forms sharing a section and removes only the unmounted registration", () => {
		const { rerender } = render(
			<SettingsDraftProvider>
				<FormStatus key="first" dirty />
				<FormStatus key="second" dirty busy />
				<DraftState />
			</SettingsDraftProvider>,
		);
		expect(screen.getByTestId("draft-state").textContent).toBe(
			JSON.stringify({ dirtySections: ["services"], busy: true }),
		);
		rerender(
			<SettingsDraftProvider>
				<FormStatus key="first" dirty />
				<DraftState />
			</SettingsDraftProvider>,
		);
		expect(screen.getByTestId("draft-state").textContent).toBe(
			JSON.stringify({ dirtySections: ["services"], busy: false }),
		);
		rerender(
			<SettingsDraftProvider>
				<FormStatus key="first" dirty={false} />
				<DraftState />
			</SettingsDraftProvider>,
		);
		expect(screen.getByTestId("draft-state").textContent).toBe(JSON.stringify({ dirtySections: [], busy: false }));
	});

	it("keeps a failed credential draft guarded, clears it on Cancel, and guards an active save", async () => {
		let finishSave: (() => void) | undefined;
		const onSaveKey = vi
			.fn()
			.mockRejectedValueOnce(new Error("Save failed"))
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						finishSave = resolve;
					}),
			);
		render(
			<SettingsDraftProvider>
				<ComposerIntentSection enabled={false} keySource="none" status="unconfigured" onSaveKey={onSaveKey} />
				<DraftState />
			</SettingsDraftProvider>,
		);
		fireEvent.change(screen.getByLabelText("TypeSafe API key"), { target: { value: "temporary draft" } });
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));
		await screen.findByText("Save failed");
		await waitFor(() =>
			expect(screen.getByTestId("draft-state").textContent).toBe(
				JSON.stringify({ dirtySections: ["services"], busy: false }),
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.getByTestId("draft-state").textContent).toBe(JSON.stringify({ dirtySections: [], busy: false }));
		fireEvent.change(screen.getByLabelText("TypeSafe API key"), { target: { value: "retry draft" } });
		fireEvent.click(screen.getByRole("button", { name: "Save key" }));
		expect(screen.getByTestId("draft-state").textContent).toBe(
			JSON.stringify({ dirtySections: ["services"], busy: true }),
		);
		finishSave?.();
		await waitFor(() =>
			expect(screen.getByTestId("draft-state").textContent).toBe(JSON.stringify({ dirtySections: [], busy: false })),
		);
	});
});
