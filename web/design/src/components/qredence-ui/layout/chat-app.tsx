"use client";

import { AnimatedSidebarProvider } from "@prime-agent/web-design/components/qredence-ui/layout/animated-sidebar";
import { SESSION_SIDEBAR_WIDTH_CSS } from "@prime-agent/web-design/lib/layout-constants";
import { cn } from "@prime-agent/web-design/lib/utils";
import type { ComponentProps } from "react";

export type ChatAppProps = ComponentProps<typeof AnimatedSidebarProvider> & {
	sidebarWidth?: string;
};

export function ChatApp({
	children,
	className,
	sidebarWidth = SESSION_SIDEBAR_WIDTH_CSS,
	style,
	...props
}: ChatAppProps) {
	return (
		<AnimatedSidebarProvider
			{...props}
			style={{ ...style, "--sidebar-width": sidebarWidth }}
			className={cn("min-h-0 w-full overflow-hidden rounded-2xl border border-border bg-background", className)}
		>
			{children}
		</AnimatedSidebarProvider>
	);
}
