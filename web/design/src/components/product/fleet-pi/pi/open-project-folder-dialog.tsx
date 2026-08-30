import { ArrowUp, Folder, FolderOpen } from "lucide-react"
import { useCallback, useEffect, useId, useState } from "react"
import { Button } from "../../../ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog"
import { Input } from "../../../ui/input"
import { Spinner } from "../../../ui/spinner"
import { cn } from "../../../../lib/utils"
import type { WorkspaceBrowseResponse } from "@prime-agent/web-protocol/chat-protocol"

export type OpenProjectFolderDialogProps = {
  browseWorkspace: (path?: string) => Promise<WorkspaceBrowseResponse>
  initialPath: string
  onOpenChange: (open: boolean) => void
  onSelectRoot: (path: string) => Promise<void>
  open: boolean
}

export function OpenProjectFolderDialog({
  browseWorkspace,
  initialPath,
  onOpenChange,
  onSelectRoot,
  open,
}: OpenProjectFolderDialogProps) {
  const pathInputId = useId()
  const [pathInput, setPathInput] = useState(initialPath)
  const [browse, setBrowse] = useState<WorkspaceBrowseResponse | null>(null)
  const [selectedPath, setSelectedPath] = useState(initialPath)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPath = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      try {
        const result = await browseWorkspace(path)
        setBrowse(result)
        setPathInput(result.path)
        setSelectedPath(result.path)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [browseWorkspace]
  )

  useEffect(() => {
    if (!open) return
    void loadPath(initialPath)
  }, [initialPath, loadPath, open])

  const handleGo = () => {
    void loadPath(pathInput.trim() || initialPath)
  }

  const handleOpen = async () => {
    const target = selectedPath.trim()
    if (!target) return
    setSubmitting(true)
    setError(null)
    try {
      await onSelectRoot(target)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="open-project-folder-dialog"
      >
        <DialogHeader>
          <DialogTitle>Open project folder</DialogTitle>
          <DialogDescription>
            Choose the local directory that becomes the prime-agent workspace
            root.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={pathInputId}>
              Folder path
            </label>
            <Input
              id={pathInputId}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  handleGo()
                }
              }}
              placeholder="/path/to/project"
              spellCheck={false}
              value={pathInput}
            />
            <Button
              disabled={loading || submitting}
              onClick={handleGo}
              type="button"
              variant="outline"
            >
              Go
            </Button>
          </div>

          <div
            className="flex max-h-64 min-h-40 flex-col overflow-hidden rounded-lg border border-border/70 bg-muted/20"
            data-testid="open-project-folder-list"
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
              <Button
                disabled={loading || submitting || !browse?.parent}
                onClick={() => {
                  if (browse?.parent) void loadPath(browse.parent)
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ArrowUp className="size-3.5" />
                Up
              </Button>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {browse?.path ?? pathInput}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  Loading…
                </div>
              ) : browse && browse.entries.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No subfolders
                </p>
              ) : (
                browse?.entries.map((entry) => {
                  const isSelected = selectedPath === entry.path
                  return (
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                        isSelected && "bg-muted text-foreground"
                      )}
                      key={entry.path}
                      onClick={() => setSelectedPath(entry.path)}
                      onDoubleClick={() => void loadPath(entry.path)}
                      type="button"
                    >
                      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{entry.name}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={loading || submitting || !selectedPath.trim()}
            onClick={() => void handleOpen()}
            type="button"
          >
            {submitting ? (
              <>
                <Spinner className="size-3.5" />
                Opening…
              </>
            ) : (
              <>
                <FolderOpen className="size-3.5" data-icon="inline-start" />
                Open
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
