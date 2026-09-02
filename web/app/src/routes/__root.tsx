import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"
import { useEffect, useLayoutEffect } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { MotionRuntime } from "@prime-agent/web-design/components/registry/beui/motion/runtime"
import { Toaster } from "@prime-agent/web-design/components/ui/toast"
import { NotFoundPage } from "@prime-agent/web-design/components/product/fleet-pi/not-found-page"
import {
  DEFAULT_UI_PREFERENCES,
  readUiPreferences,
} from "@prime-agent/web-design/lib/ui-preferences"

import appCss from "@prime-agent/web-design/globals.css?url"
import { getQueryClient } from "@/lib/query-client"
import { initAnalytics } from "@/lib/analytics-stub"

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
        rel: "icon",
        href: "/favicon.svg",
        type: "image/svg+xml",
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
})

/**
 * Renders the application shell and initializes user interface preferences and analytics.
 */
function RootComponent() {
  useLayoutEffect(() => {
    const preferences = readUiPreferences()
    document.documentElement.dataset.density = preferences.density
    document.documentElement.classList.toggle(
      "reduce-motion",
      preferences.motion === "reduced",
    )
  }, [])
  useEffect(() => {
    initAnalytics()
  }, [])

  return (
    <MotionRuntime>
      <QueryClientProvider client={getQueryClient()}>
        <Outlet />
      </QueryClientProvider>
    </MotionRuntime>
  )
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
  )
}
