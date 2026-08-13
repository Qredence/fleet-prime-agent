import React, { memo } from "react"
import { MultiFileDiff } from "@pierre/diffs/react"
import { IconChevronDown } from "@tabler/icons-react"
import { useToolComplete } from "../hooks/use-tool-complete"
import { TextShimmer } from "../text-shimmer"
import { FileExtIcon } from "../icons/file-ext-icon"
import { adaptToolPart } from "../utils/tool-adapters"
import { ToolApprovalFooter } from "./tool-approval-footer"
import type { ToolApproval } from "./tool-approval-footer"
import type { FileContents } from "@pierre/diffs/react"
import type { StepState, TimelineStep } from "../types/timeline"

type EditToolDiffCardProps = {
  step: Extract<TimelineStep, { type: "tool-call" }>
  state: StepState
  onComplete: () => void
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  isCollapsible?: boolean
  approval?: ToolApproval
  onFilePathClick?: (path: string) => void
}

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
  useToolComplete(state === "animating", step.duration, onComplete)
  const isPending = state === "animating"
  const fileName = step.filePath?.split("/").pop() ?? step.toolDetail
  const hasFileName = Boolean(fileName)
  const isWrite = step.toolName === "Write"
  const [themeType, setThemeType] = React.useState<"light" | "dark">("light")
  const [isExpanded, setIsExpanded] = React.useState(!isCollapsible)

  React.useEffect(() => {
    if (typeof window === "undefined") return
    const updateTheme = () => {
      const isDark = document.documentElement.classList.contains("dark")
      setThemeType(isDark ? "dark" : "light")
    }
    updateTheme()

    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  React.useEffect(() => {
    setIsExpanded(!isCollapsible)
  }, [isCollapsible])

  const diffFiles = React.useMemo(() => {
    const fileLabel = fileName || "file"
    const oldFromOutput =
      typeof output?.old_content === "string" ? output.old_content : undefined
    const newFromOutput =
      typeof output?.content === "string" ? output.content : undefined
    const oldFromInput =
      !oldFromOutput && typeof input?.old_string === "string"
        ? input.old_string
        : undefined
    const newFromInput =
      !newFromOutput && typeof input?.new_string === "string"
        ? input.new_string
        : undefined

    const fallbackOld = step.diffLines
      ?.filter((line) => line.type !== "add")
      .map((line) => line.content)
      .join("\n")
    const fallbackNew = step.diffLines
      ?.filter((line) => line.type !== "remove")
      .map((line) => line.content)
      .join("\n")

    const oldContents = oldFromInput ?? oldFromOutput ?? fallbackOld ?? ""
    const newContents = newFromInput ?? newFromOutput ?? fallbackNew ?? ""

    if (!oldContents && !newContents) return null

    const oldFile: FileContents = {
      name: fileLabel,
      contents: oldContents,
    }
    const newFile: FileContents = {
      name: fileLabel,
      contents: newContents,
    }

    return { oldFile, newFile }
  }, [fileName, input, output, step.diffLines])

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
    [themeType]
  )

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
    [themeType]
  )

  const diffClassName =
    "an-edit-diff dark:bg-black dark:[--diffs-bg:#000] dark:[--diffs-bg-buffer-override:#000] dark:[--diffs-bg-context-override:#000] dark:[--diffs-bg-hover-override:#0a0a0a] dark:[--diffs-bg-separator-override:#0f0f0f]"

  return (
    <div className="an-edit-tool-card overflow-hidden rounded-an-tool-border-radius border border-an-tool-border-color bg-an-tool-background dark:bg-black">
      <div
        className={
          // Explicit bg-an-tool-background so the header keeps its light-grey
          // contrast in dark mode — the wrapper forces `dark:bg-black` for the
          // diff body, which would otherwise bleed into the header.
          "flex h-7 items-center justify-between bg-an-tool-background px-2.5 py-0 " +
          (isPending && !diffFiles
            ? ""
            : "border-b border-an-tool-border-color")
        }
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {hasFileName && (
            <FileExtIcon filename={fileName} className="h-3 w-3 shrink-0" />
          )}
          {isPending && !diffFiles ? (
            <TextShimmer as="span" duration={1.2} className="text-xs">
              Generating...
            </TextShimmer>
          ) : isPending ? (
            <TextShimmer as="span" duration={1.2} className="text-xs">
              {isWrite ? "Creating" : "Editing"} {fileName}
            </TextShimmer>
          ) : (
            <span className="truncate text-xs text-an-tool-color-muted">
              {isWrite ? "Created" : "Edited"}{" "}
              {step.filePath && onFilePathClick ? (
                <button
                  type="button"
                  onClick={() => onFilePathClick(step.filePath ?? "")}
                  className="truncate underline-offset-2 hover:text-an-tool-color hover:underline"
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
          <span className="inline-flex gap-2 font-mono text-[11px] text-an-tool-color-muted">
            {step.diffStats.split(" ").map((token) => (
              <span
                key={token}
                className={
                  token.startsWith("+")
                    ? "text-an-diff-added-text"
                    : token.startsWith("-")
                      ? "text-an-diff-removed-text"
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
        <div className={`${diffClassName} text-[12px]`} style={diffCssVars}>
          <div
            className={isCollapsible ? "group/edit-diff relative" : "relative"}
          >
            <div
              className={
                isCollapsible && !isExpanded
                  ? "max-h-[260px] overflow-hidden"
                  : undefined
              }
            >
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
                    (isExpanded
                      ? "bg-transparent"
                      : "bg-linear-to-b from-transparent to-background")
                  }
                >
                  <IconChevronDown
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
  )
}

export type EditToolProps = {
  part: any
  isCollapsible?: boolean
  onFilePathClick?: (path: string) => void
}

export const EditTool = memo(function EditTool({
  part,
  isCollapsible = false,
  onFilePathClick,
}: EditToolProps) {
  const approval = (part.input?.approval ?? part.args?.approval) as
    ToolApproval | undefined
  const toolName = (part.type as string)?.replace("tool-", "") || "Edit"
  const { step, stepState } = adaptToolPart(part, toolName)
  const noop = () => {}

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
  )
})
