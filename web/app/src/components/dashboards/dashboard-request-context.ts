import { createContext } from "react";
import type { RightPanelData } from "@/components/layout/right-panel-data";

export const DashboardRequestContext = createContext<Pick<
	RightPanelData,
	"artifactRuns" | "presentation" | "openArtifact" | "setRightPanel"
> | null>(null);
