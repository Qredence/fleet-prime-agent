import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ResourcesSection } from "@/components/settings/resources-section";

it("keeps path configuration available and distinguishes discovery from loaded skills", async () => {
	render(
		<ResourcesSection
			draft={null}
			onEnableSkillCommandsChange={vi.fn()}
			onSkillsChange={vi.fn()}
			onRevert={vi.fn()}
			onSave={vi.fn()}
			resourceDirty={false}
			saving={false}
			settingsLoading={false}
			resources={{
				snapshotState: "available",
				skills: [
					{
						name: "Loaded skill",
						description: "A loaded skill description",
						path: "/project/skills/loaded/SKILL.md",
						scope: "project",
						origin: "top-level",
						discoverySource: "daemon",
						loadedInSession: true,
					},
					{
						name: "Discovered skill",
						description: "A discovered skill description",
						path: "/user/skills/discovered/SKILL.md",
						scope: "user",
						discoverySource: "legacy-discovery",
					},
				],
				prompts: [],
				packages: [],
				extensions: [],
				themes: [],
				agentsFiles: [],
				diagnostics: [],
			}}
		/>,
	);
	expect(screen.getByText("Additional skill paths")).toBeTruthy();
	expect(screen.getByText("Loaded in session · Daemon snapshot")).toBeTruthy();
	expect(screen.getByText("Configuration discovery")).toBeTruthy();
	fireEvent.change(screen.getByLabelText("Search discovered skills"), { target: { value: "Discovered skill" } });
	expect(screen.queryByText("Loaded skill")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Details for skill Discovered skill" }));
	expect(await screen.findByText("/user/skills/discovered/SKILL.md")).toBeTruthy();
});
