"use client";

import type { ComponentProps } from "react";
import { AnimatedSidebarProvider } from "@/components/layout/animated-sidebar";
import { SESSION_SIDEBAR_WIDTH_CSS } from "@/lib/layout-constants";
import { cn } from "@/lib/utils";

export type ChatAppProps = ComponentProps<typeof AnimatedSidebarProvider> & {
	sidebarWidth?: string;
};

/** Provides the animated sidebar layout with Fleet's shared default sidebar width. */
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
