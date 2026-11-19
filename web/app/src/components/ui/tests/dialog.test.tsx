import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

describe("Dialog", () => {
	it("renders its content and closes on Escape", async () => {
		render(
			<Dialog defaultOpen>
				<DialogContent>
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>Choose preferences.</DialogDescription>
				</DialogContent>
			</Dialog>,
		);

		const dialog = await screen.findByRole("dialog", { name: "Settings" });
		expect(dialog).toBeTruthy();
		fireEvent.keyDown(dialog, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
	});
});
