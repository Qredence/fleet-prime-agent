import interWoff2 from "@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Agentation } from "agentation";
import { useEffect, useLayoutEffect } from "react";
import { FluidRoot } from "@/components/fluid-root";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/toast";
import { initAnalytics } from "@/lib/analytics-stub";
import { getQueryClient } from "@/lib/query-client";
import { applyUiPreferencesToDocument, DEFAULT_UI_PREFERENCES, readUiPreferences } from "@/lib/ui-preferences";
import appCss from "@/styles/globals.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
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
	notFoundComponent: () => (
		<main className="container mx-auto flex min-h-svh items-center justify-center p-4">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>404</CardTitle>
					<CardDescription>The requested page could not be found.</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">Check the URL or return to the home page.</p>
				</CardContent>
			</Card>
		</main>
	),
	shellComponent: RootDocument,
});

/**
 * Renders the application shell and initializes user interface preferences and analytics.
 */
function RootComponent() {
	useLayoutEffect(() => {
		applyUiPreferencesToDocument(readUiPreferences());
	}, []);
	useEffect(() => {
		initAnalytics();
	}, []);

	return (
		<FluidRoot>
			<QueryClientProvider client={getQueryClient()}>
				<Outlet />
				{import.meta.env.DEV && import.meta.env.VITE_FLEET_DISABLE_AGENTATION !== "1" ? (
					<Agentation endpoint="http://localhost:4747" />
				) : null}
			</QueryClientProvider>
			<Toaster />
		</FluidRoot>
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
			<body className="antialiased">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
