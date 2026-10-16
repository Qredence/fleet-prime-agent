import type { FileContents } from "@pierre/diffs/react";
import { MultiFileDiff } from "@pierre/diffs/react";
import { ChevronDown } from "lucide-react";
import React, { memo } from "react";
import type { StepState, TimelineStep } from "@/components/tools/timeline";
import type { ToolApproval } from "@/components/tools/tool-approval-footer";
import { ToolApprovalFooter } from "@/components/tools/tool-approval-footer";
import { ToolTextShimmer } from "@/components/tools/tool-text-shimmer";
import { useToolComplete } from "@/components/tools/utils/format-tool";
import { adaptToolPart } from "@/components/tools/utils/tool-adapters";

function FileExtIcon({ filename, className }: { filename: string; className?: string }) {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	const cls = className ?? "w-2.5 h-2.5 shrink-0";

	if (ext === "ts" || ext === "tsx") {
		return (
			<svg viewBox="0 0 32 32" className={cls}>
				<path
					d="M23.827,8.243A4.424,4.424,0,0,1,26.05,9.524a5.853,5.853,0,0,1,.852,1.143c.011.045-1.534,1.083-2.471,1.662-.034.023-.169-.124-.322-.35a2.014,2.014,0,0,0-1.67-1c-1.077-.074-1.771.49-1.766,1.433a1.3,1.3,0,0,0,.153.666c.237.49.677.784,2.059,1.383,2.544,1.095,3.636,1.817,4.31,2.843a5.158,5.158,0,0,1,.416,4.333,4.764,4.764,0,0,1-3.932,2.815,10.9,10.9,0,0,1-2.708-.028,6.531,6.531,0,0,1-3.616-1.884,6.278,6.278,0,0,1-.926-1.371,2.655,2.655,0,0,1,.327-.208c.158-.09.756-.434,1.32-.761L19.1,19.6l.214.312a4.771,4.771,0,0,0,1.35,1.292,3.3,3.3,0,0,0,3.458-.175,1.545,1.545,0,0,0,.2-1.974c-.276-.395-.84-.727-2.443-1.422a8.8,8.8,0,0,1-3.349-2.055,4.687,4.687,0,0,1-.976-1.777,7.116,7.116,0,0,1-.062-2.268,4.332,4.332,0,0,1,3.644-3.374A9,9,0,0,1,23.827,8.243ZM15.484,9.726l.011,1.454h-4.63V24.328H7.6V11.183H2.97V9.755A13.986,13.986,0,0,1,3.01,8.289c.017-.023,2.832-.034,6.245-.028l6.211.017Z"
					fill="#007acc"
				/>
			</svg>
		);
	}
	if (ext === "js" || ext === "mjs" || ext === "cjs" || ext === "jsx") {
		return (
			<svg viewBox="0 0 32 32" className={cls}>
				<rect x="2" y="2" width="28" height="28" rx="1.312" fill="#f5de19" />
				<path
					d="M20.809,23.875a2.866,2.866,0,0,0,2.6,1.6c1.09,0,1.787-.545,1.787-1.3,0-.9-.715-1.222-1.916-1.747l-.658-.282c-1.9-.809-3.16-1.822-3.16-3.964,0-1.973,1.5-3.476,3.853-3.476a3.889,3.889,0,0,1,3.742,2.107L25,18.128A1.789,1.789,0,0,0,23.311,17a1.145,1.145,0,0,0-1.259,1.128c0,.789.489,1.109,1.618,1.6l.658.282c2.236.959,3.5,1.936,3.5,4.133,0,2.369-1.861,3.667-4.36,3.667a5.055,5.055,0,0,1-4.795-2.691Zm-9.295.228c.413.733.789,1.353,1.693,1.353.864,0,1.41-.338,1.41-1.653V14.856h2.631v8.982c0,2.724-1.6,3.964-3.929,3.964a4.085,4.085,0,0,1-3.947-2.4Z"
					fill="#000"
				/>
			</svg>
		);
	}
	if (ext === "json" || ext === "jsonc") {
		return (
			<svg viewBox="0 0 32 32" className={cls}>
				<path
					d="M4.014,14.976a2.51,2.51,0,0,0,1.567-.518A2.377,2.377,0,0,0,6.386,13l.129-1.334A5.435,5.435,0,0,1,7.6,9.071,3.157,3.157,0,0,1,10.519,8h1.316v1.86H10.937a1.257,1.257,0,0,0-1.1.465,3.405,3.405,0,0,0-.357,1.585l-.127,1.244a3.283,3.283,0,0,1-.573,1.61A2.482,2.482,0,0,1,7.6,15.537a2.482,2.482,0,0,1,1.18.773A3.283,3.283,0,0,1,9.349,17.9l.127,1.244a3.405,3.405,0,0,0,.357,1.585,1.257,1.257,0,0,0,1.1.465h.9V23.06H10.519A3.157,3.157,0,0,1,7.6,21.981a5.435,5.435,0,0,1-1.082-2.595L6.386,18.05a2.377,2.377,0,0,0-.805-1.456A2.51,2.51,0,0,0,4.014,16.07Z"
					fill="#fbc02d"
				/>
				<path
					d="M27.986,16.07a2.51,2.51,0,0,0-1.567.518,2.377,2.377,0,0,0-.805,1.456l-.129,1.334a5.435,5.435,0,0,1-1.082,2.595A3.157,3.157,0,0,1,21.481,23.06H20.165V21.2h.9a1.257,1.257,0,0,0,1.1-.465,3.405,3.405,0,0,0,.357-1.585l.127-1.244a3.283,3.283,0,0,1,.573-1.61,2.482,2.482,0,0,1,1.18-.773,2.482,2.482,0,0,1-1.18-.773,3.283,3.283,0,0,1-.573-1.61L22.527,11.9a3.405,3.405,0,0,0-.357-1.585,1.257,1.257,0,0,0-1.1-.465h-.9V8h1.316a3.157,3.157,0,0,1,2.924,1.071,5.435,5.435,0,0,1,1.082,2.595l.129,1.334A2.377,2.377,0,0,0,26.419,14.458a2.51,2.51,0,0,0,1.567.518Z"
					fill="#fbc02d"
				/>
			</svg>
		);
	}

	return null;
}

type EditToolDiffCardProps = {
	step: Extract<TimelineStep, { type: "tool-call" }>;
	state: StepState;
	onComplete: () => void;
	input?: Record<string, unknown>;
	output?: Record<string, unknown>;
	isCollapsible?: boolean;
	approval?: ToolApproval;
	onFilePathClick?: (path: string) => void;
};

function EditToolDiffCard({
	step,
	state,
	onComplete,
	input,
	output,
	isCollapsible = false,
	approval,
	onFilePathClick,
}: EditToolDiffCardProps) {
	useToolComplete(state === "animating", step.duration, onComplete);
	const isPending = state === "animating";
	const fileName = step.filePath?.split("/").pop() ?? step.toolDetail;
	const hasFileName = Boolean(fileName);
	const isWrite = step.toolName === "Write";
	const [themeType, setThemeType] = React.useState<"light" | "dark">("light");
	const [isExpanded, setIsExpanded] = React.useState(!isCollapsible);

	React.useEffect(() => {
		if (typeof window === "undefined") return;
		const updateTheme = () => {
			const isDark = document.documentElement.classList.contains("dark");
			setThemeType(isDark ? "dark" : "light");
		};
		updateTheme();

		const observer = new MutationObserver(updateTheme);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => {
			observer.disconnect();
		};
	}, []);

	React.useEffect(() => {
		setIsExpanded(!isCollapsible);
	}, [isCollapsible]);

	const diffFiles = React.useMemo(() => {
		const fileLabel = fileName || "file";
		const oldFromOutput = typeof output?.old_content === "string" ? output.old_content : undefined;
		const newFromOutput = typeof output?.content === "string" ? output.content : undefined;
		const oldFromInput = !oldFromOutput && typeof input?.old_string === "string" ? input.old_string : undefined;
		const newFromInput = !newFromOutput && typeof input?.new_string === "string" ? input.new_string : undefined;

		const fallbackOld = step.diffLines
			?.filter((line) => line.type !== "add")
			.map((line) => line.content)
			.join("\n");
		const fallbackNew = step.diffLines
			?.filter((line) => line.type !== "remove")
			.map((line) => line.content)
			.join("\n");

		const oldContents = oldFromInput ?? oldFromOutput ?? fallbackOld ?? "";
		const newContents = newFromInput ?? newFromOutput ?? fallbackNew ?? "";

		if (!oldContents && !newContents) return null;

		const oldFile: FileContents = {
			name: fileLabel,
			contents: oldContents,
		};
		const newFile: FileContents = {
			name: fileLabel,
			contents: newContents,
		};

		return { oldFile, newFile };
	}, [fileName, input, output, step.diffLines]);

	const diffCssVars = React.useMemo(
		() =>
			themeType === "dark"
				? ({
						"--diffs-bg": "#000",
						"--diffs-bg-buffer-override": "#000",
						"--diffs-bg-context-override": "#000",
						"--diffs-bg-hover-override": "#0a0a0a",
						"--diffs-bg-separator-override": "#0f0f0f",
					} as React.CSSProperties)
				: undefined,
		[themeType],
	);

	const diffUnsafeCss = React.useMemo(
		() =>
			themeType === "dark"
				? `
[data-diff],
[data-file],
[data-diffs-header],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: #000;
  --diffs-bg-buffer-override: #000;
  --diffs-bg-context-override: #000;
  --diffs-bg-hover-override: #0a0a0a;
  --diffs-bg-separator-override: #0f0f0f;
}
`
				: undefined,
		[themeType],
	);

	const diffClassName =
		"an-edit-diff dark:bg-black dark:[--diffs-bg:#000] dark:[--diffs-bg-buffer-override:#000] dark:[--diffs-bg-context-override:#000] dark:[--diffs-bg-hover-override:#0a0a0a] dark:[--diffs-bg-separator-override:#0f0f0f]";

	return (
		<div className="an-edit-tool-card overflow-hidden rounded-chat-tool border border-border bg-muted dark:bg-black">
			<div
				className={
					// Explicit bg-muted so the header keeps its light-grey
					// contrast in dark mode — the wrapper forces `dark:bg-black` for the
					// diff body, which would otherwise bleed into the header.
					"flex h-7 items-center justify-between bg-muted px-2.5 py-0 " +
					(isPending && !diffFiles ? "" : "border-b border-border")
				}
			>
				<div className="flex min-w-0 items-center gap-1.5">
					{hasFileName && <FileExtIcon filename={fileName} className="h-3 w-3 shrink-0" />}
					{isPending && !diffFiles ? (
						<ToolTextShimmer as="span" duration={1.2} className="text-xs">
							Generating...
						</ToolTextShimmer>
					) : isPending ? (
						<ToolTextShimmer as="span" duration={1.2} className="text-xs">
							{isWrite ? "Creating" : "Editing"} {fileName}
						</ToolTextShimmer>
					) : (
						<span className="truncate text-xs text-muted-foreground">
							{isWrite ? "Created" : "Edited"}{" "}
							{step.filePath && onFilePathClick ? (
								<button
									type="button"
									onClick={() => onFilePathClick(step.filePath ?? "")}
									className="truncate underline-offset-2 hover:text-foreground hover:underline"
								>
									{fileName}
								</button>
							) : (
								fileName
							)}
						</span>
					)}
				</div>
				{step.diffStats && !isPending && (
					<span className="inline-flex gap-2 font-mono text-caption text-muted-foreground">
						{step.diffStats.split(" ").map((token) => (
							<span
								key={token}
								className={
									token.startsWith("+")
										? "text-product-diff-added"
										: token.startsWith("-")
											? "text-product-diff-removed"
											: undefined
								}
							>
								{token}
							</span>
						))}
					</span>
				)}
			</div>
			{diffFiles ? (
				<div className={`${diffClassName} text-label`} style={diffCssVars}>
					<div className={isCollapsible ? "group/edit-diff relative" : "relative"}>
						<div className={isCollapsible && !isExpanded ? "max-h-[260px] overflow-hidden" : undefined}>
							<MultiFileDiff
								key={themeType}
								oldFile={diffFiles.oldFile}
								newFile={diffFiles.newFile}
								className={diffClassName}
								style={diffCssVars}
								options={{
									theme: { dark: "github-dark", light: "github-light" },
									themeType,
									unsafeCSS: diffUnsafeCss,
									diffStyle: "unified",
									disableFileHeader: true,
								}}
							/>
						</div>
						{isCollapsible && (
							<>
								<button
									type="button"
									onClick={() => setIsExpanded((prev) => !prev)}
									aria-label={isExpanded ? "Hide" : "Show more"}
									className={
										"group absolute inset-x-0 bottom-0 flex h-16 items-end justify-center pb-2 text-muted-foreground " +
										(isExpanded ? "bg-transparent" : "bg-linear-to-b from-transparent to-background")
									}
								>
									<ChevronDown
										className={
											"h-4 w-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 " +
											(isExpanded ? "rotate-180" : "rotate-0")
										}
									/>
								</button>
							</>
						)}
					</div>
				</div>
			) : null}
			{approval && <ToolApprovalFooter isPending={isPending} {...approval} />}
		</div>
	);
}

export type EditToolProps = {
	part: any;
	isCollapsible?: boolean;
	onFilePathClick?: (path: string) => void;
};

export const EditTool = memo(function EditTool({ part, isCollapsible = false, onFilePathClick }: EditToolProps) {
	const approval = (part.input?.approval ?? part.args?.approval) as ToolApproval | undefined;
	const toolName = (part.type as string)?.replace("tool-", "") || "Edit";
	const { step, stepState } = adaptToolPart(part, toolName);
	const noop = () => {};

	return (
		<EditToolDiffCard
			step={step}
			state={stepState}
			onComplete={noop}
			input={part.input ?? part.args}
			output={part.output ?? part.result}
			isCollapsible={isCollapsible}
			approval={approval}
			onFilePathClick={onFilePathClick}
		/>
	);
});
