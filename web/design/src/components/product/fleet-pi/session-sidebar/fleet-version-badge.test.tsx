import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fleetVersion } from "../../../../lib/fleet-version";
import { FleetVersionBadge } from "./fleet-version-badge";

describe("fleet version badge", () => {
	it("falls back to dev without the build-time define", () => {
		expect(fleetVersion()).toBe("dev");
	});

	it("renders the current version", () => {
		render(<FleetVersionBadge />);
		expect(screen.getByLabelText(`Fleet version ${fleetVersion()}`)).toBeTruthy();
		expect(screen.getByText(`v${fleetVersion()}`)).toBeTruthy();
	});
});
