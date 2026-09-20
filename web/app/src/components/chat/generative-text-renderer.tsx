import { lazy, Suspense, useMemo } from "react";
import { LazyMarkdown } from "@/components/chat/markdown/lazy-markdown";
import type { OpenUIArtifactCandidate } from "@/components/openui/html-artifact";
import { segmentOpenUIContent } from "@/components/openui/openui-utils";

const LazyGenerativeTextRenderer = lazy(() =>
	import("@/components/openui/openui-renderer").then(({ GenerativeTextRenderer }) => ({
		default: GenerativeTextRenderer,
	})),
);
function PlainTextFallback({ className, content }: { className?: string; content: string }) {
	return <div className={className ? `${className} whitespace-pre-wrap` : "whitespace-pre-wrap"}>{content}</div>;
}

export type SessionGenerativeTextRendererProps = {
	content: string;
	className?: string;
	isStreaming?: boolean;
	messageId?: string;
	onOpenUIAction?: (message: string) => void;
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>;
	onOpenArtifact?: (artifactId: string) => void;
};

export function SessionGenerativeTextRenderer(props: SessionGenerativeTextRendererProps) {
	const containsOpenUI = useMemo(
		() => segmentOpenUIContent(props.content).some((segment) => segment.type === "openui"),
		[props.content],
	);

	if (!containsOpenUI) {
		return <LazyMarkdown className={props.className} content={props.content} isStreaming={props.isStreaming} />;
	}

	return (
		<Suspense fallback={<PlainTextFallback className={props.className} content={props.content} />}>
			<LazyGenerativeTextRenderer {...props} />
		</Suspense>
	);
}
