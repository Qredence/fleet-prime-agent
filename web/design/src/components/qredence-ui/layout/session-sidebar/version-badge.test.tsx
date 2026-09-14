import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fleetVersion } from "../../../../lib/fleet-version";
import { VersionBadge } from "./version-badge";

describe("fleet version badge", () => {
	it("falls back to dev without the build-time define", () => {
		expect(fleetVersion()).toBe("dev");
	});

	it("renders the current version", () => {
		render(<VersionBadge />);
		expect(screen.getByLabelText(`Fleet version ${fleetVersion()}`)).toBeTruthy();
		expect(screen.getByText(`v${fleetVersion()}`)).toBeTruthy();
	});
});
