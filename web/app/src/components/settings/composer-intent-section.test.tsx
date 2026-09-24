import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerIntentSection } from "@/components/settings/composer-intent-section";

describe("ComposerIntentSection", () => {
	it.each([
		[new Error("Removal failed"), "Removal failed"],
		["rejected", "Failed to remove key"],
	])("shows a failed key removal and lets the user retry", async (error, message) => {
		const onClearKey = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
		render(<ComposerIntentSection enabled={false} keySource="settings" status="ready" onClearKey={onClearKey} />);
		fireEvent.change(screen.getByLabelText("TypeSafe API key"), { target: { value: "draft" } });
		fireEvent.click(screen.getByRole("button", { name: "Remove key" }));

		await screen.findByText(message);
		expect((screen.getByLabelText("TypeSafe API key") as HTMLInputElement).value).toBe("draft");
		fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
		await waitFor(() => expect(onClearKey).toHaveBeenCalledTimes(2));
		await waitFor(() => expect((screen.getByLabelText("TypeSafe API key") as HTMLInputElement).value).toBe(""));
		expect(screen.queryByText(message)).toBeNull();
	});
});
