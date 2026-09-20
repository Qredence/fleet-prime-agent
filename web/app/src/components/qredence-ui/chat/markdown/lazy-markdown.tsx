import { lazy, Suspense } from "react";
import type { MarkdownProps } from "@/components/qredence-ui/chat/markdown/markdown";

const MarkdownContent = lazy(() =>
	import("@/components/qredence-ui/chat/markdown/markdown").then(({ Markdown }) => ({ default: Markdown })),
);

export function LazyMarkdown(props: MarkdownProps) {
	return (
		<Suspense
			fallback={
				<div className={props.className ? `${props.className} whitespace-pre-wrap` : "whitespace-pre-wrap"}>
					{props.content}
				</div>
			}
		>
			<MarkdownContent {...props} />
		</Suspense>
	);
}
