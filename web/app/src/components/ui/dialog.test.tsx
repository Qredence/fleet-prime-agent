import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

describe("Dialog", () => {
	it("opens from its trigger and closes on Escape", async () => {
		render(
			<Dialog>
				<DialogTrigger>Open settings</DialogTrigger>
				<DialogContent>
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>Choose preferences.</DialogDescription>
				</DialogContent>
			</Dialog>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
		const dialog = await screen.findByRole("dialog", { name: "Settings" });
		expect(dialog).toBeTruthy();
		fireEvent.keyDown(dialog, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
	});
});
