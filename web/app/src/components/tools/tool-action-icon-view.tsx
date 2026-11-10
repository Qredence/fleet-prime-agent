import type { LucideIcon } from "lucide-react";
import { createElement, type ComponentProps, type ComponentType } from "react";
import { toolActionIconForName } from "@/components/tools/tool-action-icon";

type LucideIconProps = ComponentProps<LucideIcon>;

export function ToolActionIcon({ name, ...props }: { name: string } & LucideIconProps) {
	return createElement(toolActionIconForName(name), props);
}

export function LucideIconView({
	icon,
	...props
}: {
	icon: LucideIcon | ComponentType<{ className?: string }>;
} & LucideIconProps) {
	return createElement(icon, props);
}
