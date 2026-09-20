import { memo } from "react";
import { SpecializedToolRenderer } from "@/components/qredence-ui/tools/specialized-tool-renderer";
import type { ToolRendererProps } from "@/components/qredence-ui/tools/tool-renderer";
import { ToolRenderer } from "@/components/qredence-ui/tools/tool-renderer";

/** Hides private reasoning parts and dispatches other tool parts to specialized or generic presentations. */
export const SessionToolRenderer = memo(function SessionToolRenderer(props: ToolRendererProps) {
	const partType = props.part.type as string;
	if (partType === "tool-Thinking" || partType === "tool-FleetReasoning") return null;

	if (partType.startsWith("tool-")) {
		return <SpecializedToolRenderer {...props} />;
	}

	return <ToolRenderer {...props} />;
});
