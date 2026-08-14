import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"
import { useEffect } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@prime-agent/web-design/components/sonner"
import { NotFoundPage } from "@prime-agent/web-design/components/fleet-pi/not-found-page"

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

function RootComponent() {
  useEffect(() => {
    initAnalytics()
  }, [])

  return (
    <QueryClientProvider client={getQueryClient()}>
      <Outlet />
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
