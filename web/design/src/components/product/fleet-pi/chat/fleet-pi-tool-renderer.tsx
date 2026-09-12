import { memo } from "react";
import type { ToolRendererProps } from "../../../registry/beui/agents/tools/tool-renderer";
import { ToolRenderer } from "../../../registry/beui/agents/tools/tool-renderer";
import { BeuiToolRenderer } from "./beui-tool-renderer";

export const FleetPiToolRenderer = memo(function FleetPiToolRenderer(props: ToolRendererProps) {
	const partType = props.part.type as string;
	if (partType === "tool-Thinking" || partType === "tool-FleetReasoning") return null;

	const fallback = <ToolRenderer {...props} />;

	if (partType.startsWith("tool-")) {
		return <BeuiToolRenderer {...props} fallback={fallback} />;
	}

	return fallback;
});
