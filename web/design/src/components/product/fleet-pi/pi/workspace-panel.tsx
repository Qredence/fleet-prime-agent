import {
  CircleAlert,
  FileText,
  HardDrive,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Markdown } from "../../../registry/beui/agents/markdown"
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "../../../registry/beui/motion/file-tree"
import {
  CHAT_PANEL_BREAKPOINT_PX,
  WORKSPACE_SPLIT_GAP_RESET,
  WORKSPACE_SPLIT_HIDDEN_BLOCK,
} from "../../../../lib/layout-constants"
import { isPathWithinScope } from "../../../../lib/workspace-path-nav"
import { isDaytonaNotConnectedError } from "../../../../lib/pi/chat-helpers"
import { useWorkspaceSplitLayout } from "./hooks/use-workspace-split-layout"
import { ResourceChipSection, ResourceNotice } from "./shared"
import { findWorkspaceNode } from "./resource-helpers"
import { WorkspacePreviewSkeleton, WorkspaceSkeleton } from "./skeleton-loaders"
import type { ReactNode, RefObject } from "react"
import type {
  WorkspaceFileResponse,
  WorkspaceTreeNode,
  WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"

export type WorkspacePanelContentProps = {
  error?: Error | null
  emptyDescription?: string
  emptyTitle?: string
  loadWorkspaceFile: (path: string) => Promise<WorkspaceFileResponse>
  loading: boolean
  onSelectedPathChange?: (path: string | null) => void
  previewEmptyDescription?: string
  previewEmptyTitle?: string
  scopePath?: string
  scopeLabel?: string
  selectedPath?: string | null
  treeTestId?: string
  workspace: WorkspaceTreeResponse | null
}

export function WorkspacePanelContent({
  error,
  emptyDescription = "agent-workspace has not been loaded yet.",
  emptyTitle = "Workspace unavailable",
  loadWorkspaceFile,
  loading,
  onSelectedPathChange,
  previewEmptyDescription = "Choose a workspace file to preview its Markdown.",
  previewEmptyTitle = "Select a file",
  scopePath,
  scopeLabel,
  selectedPath: selectedPathProp,
  treeTestId = "workspace-tree",
  workspace,
}: WorkspacePanelContentProps) {
  const [internalSelectedPath, setInternalSelectedPath] = useState<
    string | null
  >(null)
  const isControlled = onSelectedPathChange !== undefined
  const selectedPath = isControlled
    ? (selectedPathProp ?? null)
    : internalSelectedPath
  const setSelectedPath = (path: string | null) => {
    if (isControlled) {
      onSelectedPathChange(path)
      return
    }
    setInternalSelectedPath(path)
  }
  const [preview, setPreview] = useState<WorkspaceFileResponse | null>(null)
  const [previewError, setPreviewError] = useState<Error | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const { handleTreeResizeStart, splitRef, splitStyle } =
    useWorkspaceSplitLayout(workspace)

  const scopedView = useMemo(() => {
    if (!workspace) {
      return {
        headerLabel: scopeLabel ?? "agent-workspace",
        nodes: [] as Array<WorkspaceTreeNode>,
      }
    }

    if (!scopePath) {
      return {
        headerLabel: workspace.root,
        nodes: workspace.nodes,
      }
    }

    const scopedNode = findWorkspaceNode(workspace.nodes, scopePath)
    if (!scopedNode) {
      return {
        headerLabel: scopeLabel ?? scopePath.split("/").pop() ?? scopePath,
        nodes: [] as Array<WorkspaceTreeNode>,
      }
    }

    if (scopedNode.type === "directory") {
      return {
        headerLabel: scopeLabel ?? scopedNode.name,
        nodes: scopedNode.children ?? [],
      }
    }

    return {
      headerLabel: scopeLabel ?? scopedNode.name,
      nodes: [scopedNode],
    }
  }, [scopeLabel, scopePath, workspace])

  useEffect(() => {
    if (!workspace || !selectedPath) return

    if (scopePath && !isPathWithinScope(selectedPath, scopePath)) {
      setSelectedPath(null)
      setPreview(null)
      setPreviewError(null)
      return
    }

    if (findWorkspaceNode(workspace.nodes, selectedPath)?.type === "file") {
      return
    }

    setSelectedPath(null)
    setPreview(null)
    setPreviewError(null)
  }, [onSelectedPathChange, scopePath, selectedPath, workspace])

  useEffect(() => {
    if (!selectedPath) return

    let cancelled = false
    async function loadPreview() {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const body = await loadWorkspaceFile(selectedPath ?? "")
        if (!cancelled) setPreview(body)
      } catch (err) {
        if (!cancelled) {
          setPreview(null)
          setPreviewError(err instanceof Error ? err : new Error(String(err)))
        }
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }

    void loadPreview()
    return () => {
      cancelled = true
    }
  }, [loadWorkspaceFile, selectedPath, workspace])

  useEffect(() => {
    if (!selectedPath || typeof window === "undefined") return
    if (
      window.matchMedia(`(min-width: ${CHAT_PANEL_BREAKPOINT_PX}px)`).matches
    ) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      previewRef.current?.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "auto",
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [selectedPath])

  if (error) {
    if (isDaytonaNotConnectedError(error)) {
      return (
        <ResourceNotice
          icon={CircleAlert}
          title="Daytona not connected"
          description="Connect a Daytona API key for your account to browse and preview your agent workspace."
        />
      )
    }
    return (
      <ResourceNotice
        icon={CircleAlert}
        title="Unable to load workspace"
        description={error.message}
      />
    )
  }

  if (loading && !workspace) {
    return <WorkspaceSkeleton />
  }

  if (!workspace) {
    return (
      <ResourceNotice
        icon={HardDrive}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  if (scopePath && scopedView.nodes.length === 0) {
    return (
      <ResourceNotice
        icon={HardDrive}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return (
    <div
      ref={splitRef}
      className={`relative grid h-full min-h-0 grid-cols-1 gap-2 overflow-hidden ${WORKSPACE_SPLIT_GAP_RESET}`}
      style={splitStyle}
    >
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div
          data-testid={treeTestId}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          <div className="mb-2 flex min-w-0 items-center gap-2 rounded-sm bg-foreground/5 px-2 py-1.5">
            <HardDrive className="size-3.5 shrink-0 text-foreground/45" />
            <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/70">
              {scopedView.headerLabel}
            </span>
          </div>
          <FileTree
            ariaLabel={
              scopePath
                ? `Files in ${scopedView.headerLabel}`
                : "Workspace files"
            }
            className="gap-0.5"
            classNames={{
              item:
                "h-8 gap-1.5 rounded-sm text-label font-normal text-foreground/65 hover:bg-foreground/5 hover:text-foreground/80 aria-selected:bg-foreground/8 aria-selected:text-foreground/80",
              icon: "size-3.5 text-foreground/35",
              label: "text-label",
            }}
            value={selectedPath}
            onValueChange={(path) => {
              if (findWorkspaceNode(workspace.nodes, path)?.type === "file") {
                setSelectedPath(path)
              }
            }}
          >
            {scopedView.nodes.map((node) => renderWorkspaceNode(node))}
          </FileTree>
          {workspace.diagnostics.length > 0 && !scopePath && (
            <div className="mt-2 border-t border-border/60 pt-2">
              <ResourceChipSection
                id="workspace-diagnostics"
                label="Diagnostics"
                icon={CircleAlert}
                items={workspace.diagnostics.map((diagnostic, index) => ({
                  name: `Diagnostic ${index + 1}`,
                  description: diagnostic,
                }))}
              />
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="Resize workspace tree"
        className={`min-h-0 cursor-col-resize touch-none bg-transparent transition-colors outline-none hover:bg-foreground/10 focus-visible:bg-foreground/10 ${WORKSPACE_SPLIT_HIDDEN_BLOCK}`}
        data-testid="workspace-tree-resize-handle"
        onPointerDown={handleTreeResizeStart}
      />
      <WorkspacePreview
        emptyDescription={previewEmptyDescription}
        emptyTitle={previewEmptyTitle}
        error={previewError}
        loading={previewLoading}
        preview={preview}
        previewRef={previewRef}
        selectedPath={selectedPath}
      />
    </div>
  )
}

function renderWorkspaceNode(node: WorkspaceTreeNode): ReactNode {
  if (node.type === "directory") {
    return (
      <FileTreeFolder key={node.path} value={node.path} name={node.name}>
        {node.children?.map((child) => renderWorkspaceNode(child))}
      </FileTreeFolder>
    )
  }

  return (
    <FileTreeFile key={node.path} value={node.path} name={node.name} />
  )
}

function WorkspacePreview({
  emptyDescription,
  emptyTitle,
  error,
  loading,
  preview,
  previewRef,
  selectedPath,
}: {
  emptyDescription: string
  emptyTitle: string
  error: Error | null
  loading: boolean
  preview: WorkspaceFileResponse | null
  previewRef: RefObject<HTMLDivElement | null>
  selectedPath: string | null
}) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border/60 bg-background"
      data-testid="workspace-preview"
      ref={previewRef}
    >
      <div className="flex min-h-9 min-w-0 shrink-0 items-center gap-2 border-b border-border/60 px-2.5">
        <FileText className="size-3.5 shrink-0 text-foreground/35" />
        <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/70">
          {preview?.name ?? selectedPath ?? "Preview"}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!selectedPath && (
          <ResourceNotice
            icon={FileText}
            title={emptyTitle}
            description={emptyDescription}
          />
        )}
        {selectedPath && loading && <WorkspacePreviewSkeleton />}
        {selectedPath && error && (
          <ResourceNotice
            icon={CircleAlert}
            title="Unable to load preview"
            description={error.message}
          />
        )}
        {selectedPath &&
          !loading &&
          !error &&
          preview?.status === "too-large" && (
            <ResourceNotice
              icon={CircleAlert}
              title="Preview too large"
              description={`${preview.name} is too large to preview safely.`}
            />
          )}
        {selectedPath &&
          !loading &&
          !error &&
          preview?.status === "unsupported" && (
            <ResourceNotice
              icon={CircleAlert}
              title="Unsupported preview"
              description={`${preview.name} is not a supported text file.`}
            />
          )}
        {selectedPath &&
          !loading &&
          !error &&
          preview &&
          (preview.status === undefined || preview.status === "ok") && (
            <Markdown
              className="text-label leading-relaxed"
              content={preview.content}
            />
          )}
      </div>
    </div>
  )
}
