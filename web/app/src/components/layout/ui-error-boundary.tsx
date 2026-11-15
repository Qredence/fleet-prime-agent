import type { FallbackProps } from "react-error-boundary";
import { ErrorBoundary } from "react-error-boundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function DefaultFallback({ error, resetErrorBoundary }: FallbackProps) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<Alert variant="destructive">
			<AlertTitle>Unable to render this view</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
			<Button type="button" variant="destructive" size="compact" className="mt-1" onClick={resetErrorBoundary}>
				Retry
			</Button>
		</Alert>
	);
}

export function UiErrorBoundary({
	children,
	fallback,
	onReset,
	resetKeys,
}: {
	children: React.ReactNode;
	fallback?: React.ReactNode;
	onReset?: () => void;
	resetKeys?: Array<unknown>;
}) {
	return (
		<ErrorBoundary
			FallbackComponent={fallback ? () => fallback : DefaultFallback}
			onReset={onReset}
			resetKeys={resetKeys}
		>
			{children}
		</ErrorBoundary>
	);
}
