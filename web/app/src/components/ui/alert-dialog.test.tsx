import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function AlertDialogHarness() {
	const [open, setOpen] = useState(true);
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open confirmation
			</button>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogTitle>Delete project?</AlertDialogTitle>
					<AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

describe("AlertDialog", () => {
	it("closes from the cancel action and preserves the trigger", async () => {
		render(<AlertDialogHarness />);

		expect(await screen.findByRole("alertdialog", { name: "Delete project?" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(screen.getByRole("button", { name: "Open confirmation" })).toBeTruthy();
	});
});
