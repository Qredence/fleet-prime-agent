import { useIsStreaming } from "@openuidev/react-lang";
import { Button, Card, CardHeader, CodeBlock, Tabs, TabsContent, TabsList, TabsTrigger } from "@openuidev/react-ui";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
	validateAndNormalizeOpenUIHtmlArtifact,
	type OpenUIHtmlArtifactPayload,
	type OpenUIHtmlArtifactValidation,
} from "@prime-agent/web-protocol";

export type OpenUIArtifactCandidate = {
	assistantMessageId: string;
	artifactIndex: number;
	artifact: OpenUIHtmlArtifactPayload;
};

export type OpenUIArtifactContextValue = {
	messageId?: string;
	artifactIndex: number;
	onArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>;
	onOpenArtifact?: (artifactId: string) => void;
};

const OpenUIArtifactContext = createContext<OpenUIArtifactContextValue>({ artifactIndex: 0 });

export function OpenUIArtifactProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: OpenUIArtifactContextValue;
}) {
	return <OpenUIArtifactContext.Provider value={value}>{children}</OpenUIArtifactContext.Provider>;
}

function validationMessage(validation: OpenUIHtmlArtifactValidation): string {
	return validation.ok ? "" : validation.reason;
}

export function OpenUIHtmlFrame({
	document,
	className = "",
	title,
}: {
	document: string;
	className?: string;
	title: string;
}) {
	return (
		<iframe
			sandbox="allow-scripts"
			srcDoc={document}
			referrerPolicy="no-referrer"
			title={title}
			className={`block w-full min-w-0 overflow-hidden rounded-md border border-border/60 bg-white ${className}`}
		/>
	);
}

function ArtifactDiagnostic({ validation, document }: { validation: OpenUIHtmlArtifactValidation; document: string }) {
	if (validation.ok) return null;
	return (
		<div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
			<p className="font-medium">OpenUI artifact was not rendered</p>
			<p className="mt-1">{validationMessage(validation)}</p>
			<details className="mt-2">
				<summary className="cursor-pointer font-medium">Raw document</summary>
				<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{document}</pre>
			</details>
		</div>
	);
}

/**
 * Creates a unique key from an artifact title and document.
 *
 * @param title - The artifact title
 * @param document - The artifact document
 * @returns A key combining the title and document
 */
function artifactKey(title: string, document: string): string {
	return `${title}\u0000${document}`;
}

/**
 * Displays an HTML artifact with its title, rendered content, or validation diagnostics.
 *
 * While generation is active, displays a streaming placeholder and reports each valid artifact for later access when generation completes.
 *
 * @returns The rendered artifact card
 */
export function HtmlArtifactComponent({ props: { title, document } }: { props: OpenUIHtmlArtifactPayload }) {
	const isStreaming = useIsStreaming();
	const context = useContext(OpenUIArtifactContext);
	const validation = useMemo(() => validateAndNormalizeOpenUIHtmlArtifact({ title, document }), [document, title]);
	const reportedKeyRef = useRef<string | undefined>(undefined);
	const [artifactId, setArtifactId] = useState<string>();

	useEffect(() => {
		if (isStreaming || !validation.ok || !context.onArtifactReady || !context.messageId) return;
		const key = artifactKey(validation.value.title, validation.value.document);
		if (reportedKeyRef.current === key) return;
		reportedKeyRef.current = key;
		void Promise.resolve(
			context.onArtifactReady({
				assistantMessageId: context.messageId,
				artifactIndex: context.artifactIndex,
				artifact: validation.value,
			}),
		).then((nextId) => {
			if (nextId) setArtifactId(nextId);
		});
	}, [context, isStreaming, validation]);

	return (
		<Card variant="card" width="full" className="min-w-0 overflow-hidden">
			<CardHeader
				title={<span className="truncate text-sm font-medium">{title}</span>}
				subtitle={isStreaming ? "Generating artifact…" : validation.ok ? "OpenUI HTML artifact" : "Diagnostic"}
				actions={
					artifactId && context.onOpenArtifact ? (
						<Button
							variant="secondary"
							size="small"
							type="button"
							onClick={() => context.onOpenArtifact?.(artifactId)}
						>
							Open in Artifacts
						</Button>
					) : undefined
				}
			/>
			<div className="min-w-0 p-3">
				{isStreaming ? (
					<div className="flex min-h-16 items-center justify-center rounded-md border border-dashed border-border/70 text-xs text-muted-foreground">
						Generating artifact…
					</div>
				) : validation.ok ? (
					<OpenUIHtmlFrame document={validation.value.document} title={validation.value.title} className="h-56" />
				) : (
					<ArtifactDiagnostic validation={validation} document={document} />
				)}
			</div>
		</Card>
	);
}

/**
 * Displays an HTML artifact with rendered and raw document views.
 *
 * @param artifact - The HTML artifact to validate and display
 * @param className - Additional CSS classes for the view container
 * @returns A diagnostic view for invalid artifacts, or tabbed rendered and raw views for valid artifacts
 */
export function OpenUIHtmlArtifactView({
	artifact,
	className = "",
}: {
	artifact: OpenUIHtmlArtifactPayload;
	className?: string;
}) {
	const validation = useMemo(() => validateAndNormalizeOpenUIHtmlArtifact(artifact), [artifact]);
	if (!validation.ok) {
		return <ArtifactDiagnostic validation={validation} document={artifact.document} />;
	}

	const normalized = validation.value;
	return (
		<div className={`min-w-0 ${className}`}>
			<Tabs defaultValue="rendered" className="min-w-0">
				<TabsList aria-label="OpenUI artifact views">
					<TabsTrigger value="rendered" text="Rendered" />
					<TabsTrigger value="raw" text="Raw" />
				</TabsList>
				<TabsContent value="rendered" className="min-w-0">
					<OpenUIHtmlFrame document={normalized.document} title={normalized.title} className="min-h-[28rem]" />
				</TabsContent>
				<TabsContent value="raw" className="min-w-0">
					<CodeBlock language="html" codeString={normalized.document} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
