"use client"

import { ErrorBoundary } from "react-error-boundary"
import type { FallbackProps } from "react-error-boundary"

function DefaultFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
      <p className="font-medium">Something went wrong</p>
      <p className="text-xs opacity-70">{message}</p>
      <button
        type="button"
        onClick={resetErrorBoundary}
        className="text-destructive-foreground mt-1 rounded-md bg-destructive px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
      >
        Retry
      </button>
    </div>
  )
}

export function UiErrorBoundary({
  children,
  fallback,
  onReset,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
  onReset?: () => void
}) {
  return (
    <ErrorBoundary
      FallbackComponent={fallback ? () => fallback : DefaultFallback}
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  )
}
