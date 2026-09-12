import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { NotFoundPage } from "@prime-agent/web-design/components/product/fleet-pi/not-found-page";
import { MotionRuntime } from "@prime-agent/web-design/components/registry/beui/motion/runtime";
import { Toaster } from "@prime-agent/web-design/components/ui/toast";
import appCss from "@prime-agent/web-design/globals.css?url";
import { DEFAULT_UI_PREFERENCES, readUiPreferences } from "@prime-agent/web-design/lib/ui-preferences";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Agentation } from "agentation";
import { useEffect, useLayoutEffect } from "react";
import { initAnalytics } from "@/lib/analytics-stub";
import { getQueryClient } from "@/lib/query-client";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Fleet Prime",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "preload",
				href: interWoff2,
				as: "font",
				type: "font/woff2",
				crossOrigin: "anonymous",
			},
			{
				rel: "icon",
				href: "/favicon-dark.svg",
				type: "image/svg+xml",
				media: "(prefers-color-scheme: dark)",
			},
			{
				rel: "icon",
				href: "/favicon-light.svg",
				type: "image/svg+xml",
				media: "(prefers-color-scheme: light)",
			},
			{
				rel: "icon",
				href: "/favicon.ico",
				sizes: "any",
			},
		],
	}),
	component: RootComponent,
	notFoundComponent: () => <NotFoundPage />,
	shellComponent: RootDocument,
});

/**
 * Renders the application shell and initializes user interface preferences and analytics.
 */
function RootComponent() {
	useLayoutEffect(() => {
		const preferences = readUiPreferences();
		document.documentElement.dataset.density = preferences.density;
		document.documentElement.classList.toggle("reduce-motion", preferences.motion === "reduced");
	}, []);
	useEffect(() => {
		initAnalytics();
	}, []);

	return (
		<MotionRuntime>
			<QueryClientProvider client={getQueryClient()}>
				<Outlet />
				{import.meta.env.DEV && import.meta.env.VITE_FLEET_DISABLE_AGENTATION !== "1" ? (
					<Agentation endpoint="http://localhost:4747" />
				) : null}
			</QueryClientProvider>
		</MotionRuntime>
	);
}

/**
 * Renders the application's root HTML document shell.
 *
 * @param children - The routed application content rendered in the document body
 */
function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" data-density={DEFAULT_UI_PREFERENCES.density}>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Toaster />
				<Scripts />
			</body>
		</html>
	);
}
