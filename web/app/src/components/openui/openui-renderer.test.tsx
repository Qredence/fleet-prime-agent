import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerativeTextRenderer } from "@/components/openui/openui-renderer";

// Isolate diagnostics from the segmenter's root-first admission rule.
vi.mock("@/lib/openui/openui-utils", () => ({
	segmentOpenUIContent: (content: string) => [{ id: "openui-0", type: "openui", content }],
}));

describe("OpenUI diagnostics", () => {
	it("renders a fallback root without showing a destructive warning-only alert", async () => {
		render(<GenerativeTextRenderer content={'other = Root([Text("Fallback root")])'} />);
		expect(await screen.findByText("Fallback root")).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	});
	it("retains a failure alert for hard errors", async () => {
		render(<GenerativeTextRenderer content={"root = Root([Text(missing)])"} />);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("OpenUI could not be rendered")).toBeTruthy();
	});
});
