import type { ToolRendererProps } from "@prime-agent/web-design/components/qredence-ui/tools/tool-renderer";
import { ToolRenderer } from "@prime-agent/web-design/components/qredence-ui/tools/tool-renderer";
import { memo } from "react";
import { SpecializedToolRenderer } from "./specialized-tool-renderer";

export const SessionToolRenderer = memo(function SessionToolRenderer(props: ToolRendererProps) {
	const partType = props.part.type as string;
	if (partType === "tool-Thinking" || partType === "tool-FleetReasoning") return null;

	if (partType.startsWith("tool-")) {
		return <SpecializedToolRenderer {...props} />;
	}

	return <ToolRenderer {...props} />;
});
