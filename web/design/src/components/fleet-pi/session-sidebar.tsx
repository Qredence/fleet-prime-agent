import {
  ArrowUp,
  BookOpenText,
  ChevronDown,
  CircleHelp,
  CircleStop,
  Folder,
  FolderPlus,
  FolderOpen,
  FolderTree,
  Library,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Settings,
  SquarePen,
  TriangleAlert,
  Trash2,
  Unplug,
} from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useReducer, useRef } from "react"
import type { ReactNode } from "react"
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol"
import type {
  ProjectDirectoryBrowseResponse,
  ProjectDirectoryEntry,
  ProjectId,
  ProjectSummary,
} from "@prime-agent/web-protocol"
import type { OpenPanelAction } from "@prime-agent/web-protocol/fleet-contract"
import {
  AISidebar,
  type AISidebarProps,
  type SidebarResource,
} from "../agents/ai-sidebar"
import {
  INITIAL_SESSION_COUNT,
  sortProjectsByActivity,
  sortSessions,
  visibleProjectSessions,
} from "./session-sidebar-model"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxTrigger,
} from "../motion/combobox"
import { ProjectFolder } from "../motion/project-folder"
import { ThreadSearch, type SearchableThread } from "../elements/thread-search"
import { Popover } from "../agents/input/popover"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../alert-dialog"
import { Button } from "../button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../dialog"
import { Input } from "../input"
import { Spinner } from "../spinner"
import { normalizeSessionLabel } from "../../lib/pi/chat-helpers"
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarGroup,
  AnimatedSidebarGroupContent,
  AnimatedSidebarGroupLabel,
  AnimatedSidebarFooter,
  AnimatedSidebarHeader,
  AnimatedSidebarRail,
} from "../motion/animated-sidebar"

export type FleetSessionSidebarProps = {
  sessions: Array<ChatSessionInfo>
  projects?: Array<ProjectSummary>
  projectSessions?: Array<ChatSessionInfo>
  activeProjectId?: ProjectId
  activeSessionId?: string
  onNewSession: () => void
  onNewSessionInProject?: (projectId: ProjectId) => void | Promise<void>
  onResumeSession: (session: ChatSessionInfo) => void
  onRenameSession: (sessionId: string, title: string) => void
  onDeleteSession: (sessionId: string) => void
  onProjectSelect?: (projectId: ProjectId) => void | Promise<void>
  onCreateProject?: (request: {
    path?: string
    directoryToken?: string
    name?: string
  }) => void | Promise<void>
  onRenameProject?: (projectId: ProjectId, name: string) => void | Promise<void>
  onUnregisterProject?: (projectId: ProjectId) => void | Promise<void>
  onForkSessionIntoProject?: (
    sessionId: string,
    projectId: ProjectId,
  ) => void | Promise<void>
  onOpenPanelAction?: (action: OpenPanelAction) => void
  onBrowseDirectories?: (input: {
    path?: string
    token?: string
  }) => Promise<ProjectDirectoryBrowseResponse>
  accountMenu?: ReactNode
  onOpenSettings?: () => void
}

const DOCUMENTATION_URL = "https://docs.qredence.ai"
const EXPANDED_PROJECTS_STORAGE_KEY =
  "fleet-prime:v1:sidebar-expanded-projects"
const EMPTY_PROJECTS: Array<ProjectSummary> = []

function sessionLabel(session: ChatSessionInfo) {
  return normalizeSessionLabel(
    session.title || session.firstMessage || session.sessionId.slice(0, 8),
  )
}

function sessionDiscoveryMeta(
  session: ChatSessionInfo,
  projectById: Map<ProjectId, ProjectSummary>,
) {
  const project = session.projectId
    ? (projectById.get(session.projectId)?.name ?? "Unassigned")
    : "Unassigned"
  const status = session.status === "idle" ? "Ready" : session.status
  const messages = String(session.messageCount) + " " + (session.messageCount === 1 ? "message" : "messages")
  return project + " · " + status + " · " + messages
}

function sessionSearchGroup(updatedAt: string) {
  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) return "Earlier"
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  const difference = Math.floor((today - new Date(timestamp).setHours(0, 0, 0, 0)) / day)
  if (difference <= 0) return "Today"
  if (difference === 1) return "Yesterday"
  return "Earlier"
}
function projectResourceId(projectId: ProjectId) {
  return `project:${projectId}`
}

function sessionResourceId(sessionId: string) {
  return `session:${sessionId}`
}

function idValue(id: string, prefix: string) {
  return id.startsWith(prefix) ? id.slice(prefix.length) : null
}

function pathEntryLabel(entry: ProjectDirectoryEntry) {
  return entry.hasChildren ? `${entry.name}/` : entry.name
}

function directoryErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function readExpandedProjects(activeProjectId: ProjectId | undefined) {
  if (typeof window === "undefined") {
    return activeProjectId ? [projectResourceId(activeProjectId)] : []
  }
  const stored = window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY)
  if (!stored) return activeProjectId ? [projectResourceId(activeProjectId)] : []
  try {
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : []
  } catch {
    return activeProjectId ? [projectResourceId(activeProjectId)] : []
  }
}

type SidebarState = {
  brandMenuOpen: boolean
  projectActionsOpen: boolean
  searchOpen: boolean
  query: string
  expandedProjectIds: string[]
  revealedProjectIds: Set<ProjectId>
  renameTarget: ChatSessionInfo | null
  renameTitle: string
  renameProjectTarget: ProjectSummary | null
  renameProjectName: string
  deleteTarget: ChatSessionInfo | null
  unregisterTarget: ProjectSummary | null
  createOpen: boolean
  createPath: string
  createName: string
  directoryToken: string | undefined
  directoryBrowser: ProjectDirectoryBrowseResponse | null
  directoryBrowseLoading: boolean
  directoryBrowseError: string | null
  createSubmitting: boolean
  createSubmitError: string | null
  forkTarget: ChatSessionInfo | null
  forkProjectId: ProjectId | undefined
}

type SidebarField = {
  [Key in keyof SidebarState]: { key: Key; value: SidebarState[Key] }
}[keyof SidebarState]

type SidebarAction =
  | { type: "set"; field: SidebarField }
  | { type: "update"; update: (state: SidebarState) => SidebarState }

function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
  if (action.type === "update") return action.update(state)
  return { ...state, [action.field.key]: action.field.value } as SidebarState
}

function useFleetSessionSidebarState(activeProjectId: ProjectId | undefined) {
  const [state, dispatch] = useReducer(
    sidebarReducer,
    activeProjectId,
    (initialActiveProjectId): SidebarState => ({
      brandMenuOpen: false,
      projectActionsOpen: false,
      searchOpen: false,
      query: "",
      expandedProjectIds: readExpandedProjects(initialActiveProjectId),
      revealedProjectIds: new Set(),
      renameTarget: null,
      renameTitle: "",
      renameProjectTarget: null,
      renameProjectName: "",
      deleteTarget: null,
      unregisterTarget: null,
      createOpen: false,
      createPath: "",
      createName: "",
      directoryToken: undefined,
      directoryBrowser: null,
      directoryBrowseLoading: false,
      directoryBrowseError: null,
      createSubmitting: false,
      createSubmitError: null,
      forkTarget: null,
      forkProjectId: undefined,
    }),
  )

  const setField = useCallback(function setSidebarField<Key extends keyof SidebarState>(
    key: Key,
    value: SidebarState[Key],
  ) {
    dispatch({ type: "set", field: { key, value } as SidebarField })
  }, [])

  const updateField = useCallback(function updateSidebarField<Key extends keyof SidebarState>(
    key: Key,
    update: (value: SidebarState[Key]) => SidebarState[Key],
  ) {
    dispatch({
      type: "update",
      update: (current) => ({ ...current, [key]: update(current[key]) }),
    })
  }, [])

  const setBrandMenuOpen = useCallback((value: boolean) => setField("brandMenuOpen", value), [setField])
  const setProjectActionsOpen = useCallback(
    (value: boolean) => setField("projectActionsOpen", value),
    [setField],
  )
  const setSearchOpen = useCallback((value: boolean) => setField("searchOpen", value), [setField])
  const setQuery = useCallback((value: string) => setField("query", value), [setField])
  const setExpandedProjectIds = useCallback(
    (value: string[] | ((current: string[]) => string[])) =>
      typeof value === "function"
        ? updateField("expandedProjectIds", value)
        : setField("expandedProjectIds", value),
    [setField, updateField],
  )
  const setRevealedProjectIds = useCallback(
    (value: Set<ProjectId> | ((current: Set<ProjectId>) => Set<ProjectId>)) =>
      typeof value === "function"
        ? updateField("revealedProjectIds", value)
        : setField("revealedProjectIds", value),
    [setField, updateField],
  )
  const setRenameTarget = useCallback(
    (value: ChatSessionInfo | null) => setField("renameTarget", value),
    [setField],
  )
  const setRenameTitle = useCallback((value: string) => setField("renameTitle", value), [setField])
  const setRenameProjectTarget = useCallback(
    (value: ProjectSummary | null) => setField("renameProjectTarget", value),
    [setField],
  )
  const setRenameProjectName = useCallback(
    (value: string) => setField("renameProjectName", value),
    [setField],
  )
  const setDeleteTarget = useCallback(
    (value: ChatSessionInfo | null) => setField("deleteTarget", value),
    [setField],
  )
  const setUnregisterTarget = useCallback(
    (value: ProjectSummary | null) => setField("unregisterTarget", value),
    [setField],
  )
  const setCreateOpen = useCallback((value: boolean) => setField("createOpen", value), [setField])
  const setCreatePath = useCallback((value: string) => setField("createPath", value), [setField])
  const setCreateName = useCallback((value: string) => setField("createName", value), [setField])
  const setDirectoryToken = useCallback(
    (value: string | undefined) => setField("directoryToken", value),
    [setField],
  )
  const setDirectoryBrowser = useCallback(
    (value: ProjectDirectoryBrowseResponse | null) => setField("directoryBrowser", value),
    [setField],
  )
  const setDirectoryBrowseLoading = useCallback(
    (value: boolean) => setField("directoryBrowseLoading", value),
    [setField],
  )
  const setDirectoryBrowseError = useCallback(
    (value: string | null) => setField("directoryBrowseError", value),
    [setField],
  )
  const setCreateSubmitting = useCallback(
    (value: boolean) => setField("createSubmitting", value),
    [setField],
  )
  const setCreateSubmitError = useCallback(
    (value: string | null) => setField("createSubmitError", value),
    [setField],
  )
  const setForkTarget = useCallback(
    (value: ChatSessionInfo | null) => setField("forkTarget", value),
    [setField],
  )
  const setForkProjectId = useCallback(
    (value: ProjectId | undefined) => setField("forkProjectId", value),
    [setField],
  )

  return {
    ...state,
    setBrandMenuOpen,
    setProjectActionsOpen,
    setSearchOpen,
    setQuery,
    setExpandedProjectIds,
    setRevealedProjectIds,
    setRenameTarget,
    setRenameTitle,
    setRenameProjectTarget,
    setRenameProjectName,
    setDeleteTarget,
    setUnregisterTarget,
    setCreateOpen,
    setCreatePath,
    setCreateName,
    setDirectoryToken,
    setDirectoryBrowser,
    setDirectoryBrowseLoading,
    setDirectoryBrowseError,
    setCreateSubmitting,
    setCreateSubmitError,
    setForkTarget,
    setForkProjectId,
  }
}

type SidebarStateView = ReturnType<typeof useFleetSessionSidebarState>
type SidebarViewModelState = Pick<
  SidebarStateView,
  | "createOpen"
  | "expandedProjectIds"
  | "revealedProjectIds"
  | "setExpandedProjectIds"
  | "setRevealedProjectIds"
  | "setSearchOpen"
  | "setDirectoryBrowser"
  | "setDirectoryBrowseLoading"
  | "setDirectoryBrowseError"
  | "setDirectoryToken"
  | "setCreatePath"
  | "setRenameTarget"
  | "setRenameTitle"
  | "setForkTarget"
  | "setForkProjectId"
  | "setDeleteTarget"
  | "setRenameProjectTarget"
  | "setRenameProjectName"
  | "setUnregisterTarget"
  | "createPath"
  | "directoryToken"
  | "createName"
  | "setCreateName"
  | "setCreateOpen"
  | "setCreateSubmitError"
  | "setCreateSubmitting"
>

type SidebarViewModelOptions =
  Pick<
    FleetSessionSidebarProps,
    | "sessions"
    | "projects"
    | "projectSessions"
    | "activeProjectId"
    | "activeSessionId"
    | "onProjectSelect"
    | "onResumeSession"
    | "onCreateProject"
    | "onForkSessionIntoProject"
    | "onOpenPanelAction"
    | "onBrowseDirectories"
  > &
  SidebarViewModelState

function useFleetSessionSidebarViewModel({
  sessions,
  projects = EMPTY_PROJECTS,
  projectSessions = sessions,
  activeProjectId,
  activeSessionId,
  onProjectSelect,
  onResumeSession,
  onCreateProject,
  onForkSessionIntoProject,
  onOpenPanelAction,
  onBrowseDirectories,
  createOpen,
  expandedProjectIds,
  revealedProjectIds,
  setExpandedProjectIds,
  setRevealedProjectIds,
  setSearchOpen,
  setDirectoryBrowser,
  setDirectoryBrowseLoading,
  setDirectoryBrowseError,
  setDirectoryToken,
  setCreatePath,
  setRenameTarget,
  setRenameTitle,
  setForkTarget,
  setForkProjectId,
  setDeleteTarget,
  setRenameProjectTarget,
  setRenameProjectName,
  setUnregisterTarget,
  createPath,
  directoryToken,
  createName,
  setCreateName,
  setCreateOpen,
  setCreateSubmitError,
  setCreateSubmitting,
}: SidebarViewModelOptions) {
  const createOpenRef = useRef(false)
  const loadDirectories = useCallback(
    async (input: { path?: string; token?: string }) => {
      if (!onBrowseDirectories) return false
      setDirectoryBrowseLoading(true)
      setDirectoryBrowseError(null)
      try {
        const response = await onBrowseDirectories(input)
        setDirectoryBrowser(response)
        setDirectoryToken(response.directoryToken)
        setCreatePath(response.pathLabel)
        return true
      } catch (error) {
        setDirectoryBrowseError(
          directoryErrorMessage(error, "Could not browse this directory."),
        )
        return false
      } finally {
        setDirectoryBrowseLoading(false)
      }
    },
    [
      onBrowseDirectories,
      setCreatePath,
      setDirectoryBrowseError,
      setDirectoryBrowseLoading,
      setDirectoryBrowser,
      setDirectoryToken,
    ],
  )

  useEffect(() => {
    const opened = createOpen && !createOpenRef.current
    createOpenRef.current = createOpen
    if (!opened || !onBrowseDirectories) return
    void loadDirectories({})
  }, [createOpen, loadDirectories, onBrowseDirectories])

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.projectId, project])),
    [projects],
  )

  const sortedProjects = useMemo(
    () => sortProjectsByActivity(projects, projectSessions),
    [projectSessions, projects],
  )

  useEffect(() => {
    if (!activeProjectId) return
    const resourceId = projectResourceId(activeProjectId)
    setExpandedProjectIds((current) =>
      current.includes(resourceId) ? current : [...current, resourceId],
    )
  }, [activeProjectId, setExpandedProjectIds])

  useEffect(() => {
    window.localStorage.setItem(
      EXPANDED_PROJECTS_STORAGE_KEY,
      JSON.stringify(expandedProjectIds),
    )
  }, [expandedProjectIds])

  const sidebarItems = useMemo<SidebarResource[]>(() => {
    const grouped: SidebarResource[] = sortedProjects.map((project) => {
      const sessionsForProject = projectSessions.filter(
        (session) => session.projectId === project.projectId,
      )
      const revealed = revealedProjectIds.has(project.projectId)
      const visible = visibleProjectSessions(
        sessionsForProject,
        activeSessionId,
        revealed,
      )
      const children: SidebarResource[] = visible.map((session) => ({
        id: sessionResourceId(session.sessionId),
        label: sessionLabel(session),
        kind: "file" as const,
      }))
      if (sessionsForProject.length === 0) {
        children.push({
          id: `empty:${project.projectId}`,
          label: "No chats",
          kind: "action",
          disabled: true,
        })
      } else if (sessionsForProject.length > INITIAL_SESSION_COUNT) {
        children.push({
          id: `toggle:${project.projectId}`,
          label: revealed ? "Show less" : "Show more",
          kind: "action",
        })
      }
      return {
        id: projectResourceId(project.projectId),
        label: project.name,
        kind: "project",
        children,
      }
    })
    const unassigned = sortSessions(
      projectSessions.filter((session) => !session.projectId),
    )
    if (unassigned.length > 0) {
      const unassignedChildren: SidebarResource[] = visibleProjectSessions(
        unassigned,
        activeSessionId,
        revealedProjectIds.has("unassigned"),
      ).map((session) => ({
        id: sessionResourceId(session.sessionId),
        label: sessionLabel(session),
        kind: "file",
      }))
      if (unassigned.length > INITIAL_SESSION_COUNT) {
        unassignedChildren.push({
          id: "toggle:unassigned",
          label: revealedProjectIds.has("unassigned")
            ? "Show less"
            : "Show more",
          kind: "action",
        })
      }
      grouped.push({
        id: "project:unassigned",
        label: "Unassigned",
        kind: "folder",
        children: unassignedChildren,
      })
    }
    return grouped
  }, [activeSessionId, projectSessions, revealedProjectIds, sortedProjects])

  const resumeResource = useCallback(
    (id: string) => {
      const toggleProjectId = idValue(id, "toggle:")
      if (toggleProjectId) {
        setRevealedProjectIds((current) => {
          const next = new Set(current)
          if (next.has(toggleProjectId)) next.delete(toggleProjectId)
          else next.add(toggleProjectId)
          return next
        })
        return
      }
      const sessionId = idValue(id, "session:")
      if (!sessionId) return
      const session = projectSessions.find((entry) => entry.sessionId === sessionId)
      if (session) onResumeSession(session)
    },
    [onResumeSession, projectSessions, setRevealedProjectIds],
  )

  const toggleProjectResource = useCallback(
    (id: string) => {
      setExpandedProjectIds((current) =>
        current.includes(id)
          ? current.filter((entry) => entry !== id)
          : [...current, id],
      )
    },
    [setExpandedProjectIds],
  )

  const selectSearchResult = useCallback(
    (value: string) => {
      const projectId = idValue(value, "search-project:")
      if (projectId) {
        const resourceId = projectResourceId(projectId)
        setExpandedProjectIds((current) =>
          current.includes(resourceId) ? current : [...current, resourceId],
        )
        void onProjectSelect?.(projectId)
        setSearchOpen(false)
        return
      }
      const sessionId = idValue(value, "search-session:")
      const session = sessionId
        ? projectSessions.find((entry) => entry.sessionId === sessionId)
        : undefined
      if (!session) return
      if (session.projectId) {
        const resourceId = projectResourceId(session.projectId)
        setExpandedProjectIds((current) =>
          current.includes(resourceId) ? current : [...current, resourceId],
        )
      }
      onResumeSession(session)
      setSearchOpen(false)
    },
    [onProjectSelect, onResumeSession, projectSessions, setExpandedProjectIds, setSearchOpen],
  )

  const renderMenu = useCallback(
    (item: SidebarResource, controls: { close: () => void }) => {
      const sessionId = idValue(item.id, "session:")
      const projectId = idValue(item.id, "project:")
      if (sessionId) {
        const session = projectSessions.find((entry) => entry.sessionId === sessionId)
        if (!session) return null
        const sessionProjectId = session.projectId ?? undefined
        return (
          <>
            <button
              type="button"
              onClick={() => {
                controls.close()
                setRenameTarget(session)
                setRenameTitle(sessionLabel(session))
              }}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-muted"
            >
              <Pencil className="size-3.5" />
              Rename
            </button>
            {onForkSessionIntoProject && projects.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  controls.close()
                  setForkTarget(session)
                  setForkProjectId(
                    projects.find((project) => project.projectId !== session.projectId)
                      ?.projectId,
                  )
                }}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-muted"
              >
                <FolderTree className="size-3.5" />
                Fork into project
              </button>
            ) : null}
            {onOpenPanelAction && sessionProjectId ? (
              <>
                <div className="my-1 border-t" />
                {(
                  [
                    ["resources", "Open Resources", Library],
                    ["workspace", "Open Workspace", Folder],
                    ["artifacts", "Open Artifacts", Package],
                  ] as const
                ).map(([panel, label, Icon]) => (
                  <button
                    key={panel}
                    type="button"
                    onClick={() => {
                      controls.close()
                      onOpenPanelAction({ panel, projectId: sessionProjectId, focus: true })
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-muted"
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                controls.close()
                setDeleteTarget(session)
              }}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </>
        )
      }
      if (projectId && projectId !== "unassigned") {
        const project = projectById.get(projectId)
        if (!project) return null
        return (
          <>
            <button
              type="button"
              onClick={() => {
                controls.close()
                setRenameProjectTarget(project)
                setRenameProjectName(project.name)
              }}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-muted"
            >
              <Pencil className="size-3.5" />
              Rename project
            </button>
            <button
              type="button"
              onClick={() => {
                controls.close()
                setUnregisterTarget(project)
              }}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-destructive hover:bg-destructive/10"
            >
              <Unplug className="size-3.5" />
              Unregister project
            </button>
            {onOpenPanelAction ? (
              <>
                <div className="my-1 border-t" />
                {(
                  [
                    ["resources", "Open Resources", Library],
                    ["workspace", "Open Workspace", Folder],
                    ["artifacts", "Open Artifacts", Package],
                  ] as const
                ).map(([panel, label, Icon]) => (
                  <button
                    key={panel}
                    type="button"
                    onClick={() => {
                      controls.close()
                      onOpenPanelAction({ panel, projectId, focus: true })
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-muted"
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </>
            ) : null}
          </>
        )
      }
      return null
    },
    [
      onForkSessionIntoProject,
      onOpenPanelAction,
      projectById,
      projectSessions,
      projects,
      setDeleteTarget,
      setForkProjectId,
      setForkTarget,
      setRenameProjectName,
      setRenameProjectTarget,
      setRenameTarget,
      setRenameTitle,
      setUnregisterTarget,
    ],
  )

  const submitCreate = async () => {
    const path = createPath.trim()
    if (!onCreateProject || (!path && !directoryToken)) return
    setCreateSubmitting(true)
    setCreateSubmitError(null)
    try {
      await onCreateProject({
        path: directoryToken ? undefined : path,
        directoryToken,
        name: createName.trim() || undefined,
      })
      setCreateOpen(false)
      setCreatePath("")
      setCreateName("")
      setDirectoryToken(undefined)
      setDirectoryBrowser(null)
      setDirectoryBrowseError(null)
    } catch (error) {
      setCreateSubmitError(
        directoryErrorMessage(error, "Could not add this project."),
      )
    } finally {
      setCreateSubmitting(false)
    }
  }

  return {
    loadDirectories,
    projectById,
    sortedProjects,
    sidebarItems,
    resumeResource,
    toggleProjectResource,
    selectSearchResult,
    renderMenu,
    submitCreate,
  }
}

type SidebarNavigationProps = {
  brandMenuOpen: SidebarStateView["brandMenuOpen"]
  setBrandMenuOpen: SidebarStateView["setBrandMenuOpen"]
  searchOpen: SidebarStateView["searchOpen"]
  setSearchOpen: SidebarStateView["setSearchOpen"]
  query: SidebarStateView["query"]
  setQuery: SidebarStateView["setQuery"]
  projectActionsOpen: SidebarStateView["projectActionsOpen"]
  setProjectActionsOpen: SidebarStateView["setProjectActionsOpen"]
  expandedProjectIds: SidebarStateView["expandedProjectIds"]
  setExpandedProjectIds: SidebarStateView["setExpandedProjectIds"]
  setCreateOpen: SidebarStateView["setCreateOpen"]
  projects: Array<ProjectSummary>
  projectSessions: Array<ChatSessionInfo>
  sidebarItems: SidebarResource[]
  sortedProjects: Array<ProjectSummary>
  projectById: Map<ProjectId, ProjectSummary>
  activeProjectId?: ProjectId
  activeSessionId?: string
  onNewSession: () => void
  onNewSessionInProject?: (projectId: ProjectId) => void | Promise<void>
  onProjectSelect?: (projectId: ProjectId) => void | Promise<void>
  onRenameSession: (sessionId: string, title: string) => void
  onCreateProject?: FleetSessionSidebarProps["onCreateProject"]
  onOpenSettings?: () => void
  accountMenu?: ReactNode
  resumeResource: (id: string) => void
  toggleProjectResource: (id: string) => void
  selectSearchResult: (value: string) => void
  renderMenu: NonNullable<AISidebarProps["renderMenu"]>
}

type SidebarProjectListProps = Pick<
  SidebarNavigationProps,
  | "projectActionsOpen"
  | "setProjectActionsOpen"
  | "expandedProjectIds"
  | "setExpandedProjectIds"
  | "setCreateOpen"
  | "projects"
  | "projectSessions"
  | "sidebarItems"
  | "activeProjectId"
  | "activeSessionId"
  | "onNewSession"
  | "onNewSessionInProject"
  | "onProjectSelect"
  | "onRenameSession"
  | "onCreateProject"
  | "resumeResource"
  | "toggleProjectResource"
  | "renderMenu"
>

function FleetSessionSidebarProjectList({
  projectActionsOpen,
  setProjectActionsOpen,
  expandedProjectIds,
  setExpandedProjectIds,
  setCreateOpen,
  projects,
  projectSessions,
  sidebarItems,
  activeProjectId,
  activeSessionId,
  onNewSession,
  onNewSessionInProject,
  onProjectSelect,
  onRenameSession,
  onCreateProject,
  resumeResource,
  toggleProjectResource,
  renderMenu,
}: SidebarProjectListProps) {
  return (
    <AnimatedSidebarContent className="gap-0 px-2 py-1">
      <AnimatedSidebarGroup className="p-0">
        <div className="relative mb-1 h-8">
          <AnimatedSidebarGroupLabel className="mb-0 h-8 pr-16 text-xs font-normal normal-case tracking-normal text-muted-foreground">
            Projects
          </AnimatedSidebarGroupLabel>
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            <Popover
              open={projectActionsOpen}
              onOpenChange={setProjectActionsOpen}
              side="bottom"
              align="end"
              className="w-44 bg-popover p-1"
              trigger={
                <button
                  type="button"
                  aria-label="Project actions"
                  title="Project actions"
                  className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                >
                  <MoreHorizontal aria-hidden="true" className="size-3.5" />
                </button>
              }
            >
              {onCreateProject ? (
                <button
                  type="button"
                  onClick={() => {
                    setProjectActionsOpen(false)
                    setCreateOpen(true)
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <FolderPlus aria-hidden="true" className="size-3.5" />
                  Add project
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setProjectActionsOpen(false)
                  setExpandedProjectIds([])
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <ChevronDown aria-hidden="true" className="size-3.5" />
                Collapse all
              </button>
            </Popover>
            {onCreateProject ? (
              <button
                type="button"
                aria-label="Add project"
                title="Add project"
                onClick={() => setCreateOpen(true)}
                className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        <AnimatedSidebarGroupContent>
          {projects.length === 0 ? (
            <div className="px-2 py-4">
              <ProjectFolder
                title="Add a project"
                description="Choose a local directory for Fleet Prime."
                count={0}
                itemLabel="session"
                previews={[
                  {
                    id: "empty-project",
                    content: <FolderPlus className="size-5 text-muted-foreground" />,
                  },
                ]}
                onClick={() => setCreateOpen(true)}
                ariaLabel="Add a project"
                className="w-full"
              />
            </div>
          ) : (
            <AISidebar
              items={sidebarItems}
              activeId={activeSessionId ? sessionResourceId(activeSessionId) : null}
              activeContainerId={activeProjectId ? projectResourceId(activeProjectId) : null}
              expandedIds={expandedProjectIds}
              onExpandedIdsChange={setExpandedProjectIds}
              onActiveChange={resumeResource}
              onContainerSelect={toggleProjectResource}
              onRename={(item, label) => {
                const sessionId = idValue(item.id, "session:")
                if (sessionId) onRenameSession(sessionId, label)
              }}
              renderMenu={renderMenu}
              renderIcon={(item) => {
                const projectId = idValue(item.id, "project:")
                if (projectId) return <Folder className="size-4" />
                if (item.kind === "action") return null
                const sessionId = idValue(item.id, "session:")
                const session = projectSessions.find(
                  (entry) => entry.sessionId === sessionId,
                )
                if (session?.status === "running") {
                  return <LoaderCircle className="size-3.5 animate-spin" />
                }
                if (session?.status === "failed") {
                  return <TriangleAlert className="size-3.5 text-destructive" />
                }
                if (session?.status === "interrupted") {
                  return <CircleStop className="size-3.5 text-muted-foreground" />
                }
                return null
              }}
              renderSecondaryAction={(item) => {
                const projectId = idValue(item.id, "project:")
                if (!projectId || projectId === "unassigned") return null
                return (
                  <button
                    type="button"
                    aria-label={`New chat in ${item.label}`}
                    title={`New chat in ${item.label}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (onNewSessionInProject) {
                        void onNewSessionInProject(projectId)
                      } else {
                        void onProjectSelect?.(projectId)
                        onNewSession()
                      }
                    }}
                    className="grid size-7 shrink-0 place-items-center opacity-0 outline-none hover:bg-foreground/5 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/resource:opacity-100"
                  >
                    <MessageSquarePlus className="size-3.5" />
                  </button>
                )
              }}
              allowMove={false}
              ariaLabel="Projects and sessions"
              className="px-0"
            />
          )}
        </AnimatedSidebarGroupContent>
      </AnimatedSidebarGroup>
    </AnimatedSidebarContent>
  )
}

function FleetSessionSidebarNavigation({
  brandMenuOpen,
  setBrandMenuOpen,
  searchOpen,
  setSearchOpen,
  query,
  setQuery,
  projectActionsOpen,
  setProjectActionsOpen,
  expandedProjectIds,
  setExpandedProjectIds,
  setCreateOpen,
  projects,
  projectSessions,
  sidebarItems,
  sortedProjects,
  projectById,
  activeProjectId,
  activeSessionId,
  onNewSession,
  onNewSessionInProject,
  onProjectSelect,
  onRenameSession,
  onCreateProject,
  onOpenSettings,
  accountMenu,
  resumeResource,
  toggleProjectResource,
  selectSearchResult,
  renderMenu,
}: SidebarNavigationProps) {
  const searchThreads = useMemo<Array<SearchableThread>>(
    () =>
      sortSessions(projectSessions).map((session) => ({
        id: session.sessionId,
        title: sessionLabel(session),
        preview: sessionDiscoveryMeta(session, projectById),
        group: sessionSearchGroup(session.updatedAt),
        // Keep the initial prompt searchable; a renamed session no longer
        // matches its own first message otherwise (combobox keyword parity).
        keywords: session.firstMessage ? [normalizeSessionLabel(session.firstMessage)] : [],
      })),
    [projectById, projectSessions],
  )
  const matchingProjects = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sortedProjects
    return sortedProjects.filter((project) =>
      (project.name + " " + project.pathLabel).toLowerCase().includes(needle),
    )
  }, [query, sortedProjects])
  return (
      <AnimatedSidebar
        ariaLabel="Fleet projects and sessions"
        collapsible="offcanvas"
        className="bg-sidebar text-sidebar-foreground"
        panelClassName="border-r border-sidebar-border bg-sidebar shadow-none"
      >
        <AnimatedSidebarHeader className="gap-2 border-0 px-2.5 pb-2 pt-2.5">
          <div className="relative flex h-9 min-w-0 items-center gap-1">
            <Popover
              open={brandMenuOpen}
              onOpenChange={setBrandMenuOpen}
              side="bottom"
              align="start"
              trigger={
                <button
                  type="button"
                  className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg px-2 text-left text-sm font-medium outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                >
                  <span className="truncate">Qredence Fleet</span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
              }
              className="w-52 bg-popover p-1"
            >
              {onCreateProject ? (
                <button
                  type="button"
                  onClick={() => {
                    setBrandMenuOpen(false)
                    setCreateOpen(true)
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <FolderPlus className="size-4" />
                  Add project
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setBrandMenuOpen(false)
                  onOpenSettings?.()
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <Settings className="size-4" />
                Settings
              </button>
              <a
                href={DOCUMENTATION_URL}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <BookOpenText className="size-4" />
                Documentation
              </a>
            </Popover>

            <Popover
              open={searchOpen}
              onOpenChange={setSearchOpen}
              side="bottom"
              align="end"
              className="w-64 bg-popover p-0"
              trigger={
                <button
                  type="button"
                  aria-label="Search projects and sessions"
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                >
                  <Search className="size-4" />
                </button>
              }
            >
              <div className="max-h-[min(32rem,calc(100vh-5rem))] overflow-y-auto">
                <ThreadSearch
                  threads={searchThreads}
                  query={query}
                  activeId={activeSessionId ?? ""}
                  onQueryChange={setQuery}
                  onSelect={(sessionId) => selectSearchResult(`search-session:${sessionId}`)}
                  className="max-w-none rounded-none border-0 bg-transparent p-2 shadow-none"
                />
                <div className="border-t border-border/60 px-2 pb-2 pt-1.5">
                  <span className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
                    Projects
                  </span>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {matchingProjects.map((project) => (
                      <button
                        key={project.projectId}
                        type="button"
                        onClick={() => selectSearchResult(`search-project:${project.projectId}`)}
                        className="flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Folder className="size-3.5 shrink-0 text-muted-foreground/60" />
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        <span className="max-w-24 truncate text-[10px] text-muted-foreground/55">{project.pathLabel}</span>
                      </button>
                    ))}
                    {matchingProjects.length === 0 ? (
                      <span className="px-2 py-2 text-center text-[11px] text-muted-foreground/60">
                        No project matches “{query}”
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Popover>
          </div>
          <button
            type="button"
            onClick={onNewSession}
            className="flex h-8 w-full items-center justify-start gap-2 rounded-lg px-2 text-[13px] font-normal text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <SquarePen className="size-4 shrink-0 text-muted-foreground" />
            New chat
          </button>
        </AnimatedSidebarHeader>
        <FleetSessionSidebarProjectList
          projectActionsOpen={projectActionsOpen}
          setProjectActionsOpen={setProjectActionsOpen}
          expandedProjectIds={expandedProjectIds}
          setExpandedProjectIds={setExpandedProjectIds}
          setCreateOpen={setCreateOpen}
          projects={projects}
          projectSessions={projectSessions}
          sidebarItems={sidebarItems}
          activeProjectId={activeProjectId}
          activeSessionId={activeSessionId}
          onNewSession={onNewSession}
          onNewSessionInProject={onNewSessionInProject}
          onProjectSelect={onProjectSelect}
          onRenameSession={onRenameSession}
          onCreateProject={onCreateProject}
          resumeResource={resumeResource}
          toggleProjectResource={toggleProjectResource}
          renderMenu={renderMenu}
        />
        <AnimatedSidebarFooter className="flex-row items-center gap-1 border-sidebar-border px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="min-w-0 flex-1">{accountMenu ?? (
            <span className="flex h-8 items-center px-2 text-[13px]">Qredence</span>
          )}</div>
          <a
            href={DOCUMENTATION_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Open Qredence documentation"
            title="Help"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <CircleHelp className="size-4" />
          </a>
        </AnimatedSidebarFooter>
        <AnimatedSidebarRail />
      </AnimatedSidebar>
  )
}

type SidebarDialogsProps =
  Pick<
    FleetSessionSidebarProps,
    | "onRenameSession"
    | "onDeleteSession"
    | "onRenameProject"
    | "onUnregisterProject"
    | "onForkSessionIntoProject"
    | "onBrowseDirectories"
  > &
  { projects: Array<ProjectSummary> } &
  Pick<
    SidebarStateView,
    | "createOpen"
    | "setCreateOpen"
    | "directoryBrowser"
    | "setDirectoryBrowser"
    | "directoryBrowseLoading"
    | "directoryBrowseError"
    | "setDirectoryBrowseError"
    | "directoryToken"
    | "setDirectoryToken"
    | "createName"
    | "setCreateName"
    | "createPath"
    | "setCreatePath"
    | "renameTarget"
    | "setRenameTarget"
    | "renameTitle"
    | "setRenameTitle"
    | "renameProjectTarget"
    | "setRenameProjectTarget"
    | "renameProjectName"
    | "setRenameProjectName"
    | "deleteTarget"
    | "setDeleteTarget"
    | "unregisterTarget"
    | "setUnregisterTarget"
    | "forkTarget"
    | "setForkTarget"
    | "forkProjectId"
    | "setForkProjectId"
    | "createSubmitting"
    | "createSubmitError"
    | "setCreateSubmitError"
  > & {
    loadDirectories: (input: { path?: string; token?: string }) => Promise<boolean>
    submitCreate: () => Promise<void>
  }

type SidebarCreateDialogProps = Pick<
  SidebarDialogsProps,
  | "createOpen"
  | "setCreateOpen"
  | "directoryBrowser"
  | "setDirectoryBrowser"
  | "directoryBrowseLoading"
  | "directoryBrowseError"
  | "setDirectoryBrowseError"
  | "onBrowseDirectories"
  | "directoryToken"
  | "setDirectoryToken"
  | "createName"
  | "setCreateName"
  | "createPath"
  | "setCreatePath"
  | "loadDirectories"
  | "createSubmitting"
  | "createSubmitError"
  | "setCreateSubmitError"
  | "submitCreate"
>

function FleetSessionSidebarCreateDialog({
  createOpen,
  setCreateOpen,
  directoryBrowser,
  setDirectoryBrowser,
  directoryBrowseLoading,
  directoryBrowseError,
  setDirectoryBrowseError,
  onBrowseDirectories,
  directoryToken,
  setDirectoryToken,
  createName,
  setCreateName,
  createPath,
  setCreatePath,
  loadDirectories,
  createSubmitting,
  createSubmitError,
  setCreateSubmitError,
  submitCreate,
}: SidebarCreateDialogProps) {
  const projectNameId = useId()
  const directoryId = useId()
  const directoryHelpId = useId()
  const selectedDirectoryPath = directoryBrowser?.pathLabel ?? createPath
  const canSubmit = Boolean(directoryToken || createPath.trim().startsWith("/"))

  const resetDirectoryChoice = () => {
    setDirectoryBrowser(null)
    setDirectoryToken(undefined)
    setCreatePath("")
    setDirectoryBrowseError(null)
  }

  const closeDialog = () => {
    if (createSubmitting) return
    resetDirectoryChoice()
    setCreateName("")
    setCreateSubmitError(null)
    setCreateOpen(false)
  }

  return (
    <>
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (open) setCreateOpen(true)
          else closeDialog()
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription>
              Choose the local directory that owns this project&apos;s sessions. Browse the server
              filesystem or paste an absolute path.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium" htmlFor={projectNameId}>
                  Project name
                </label>
                <span className="text-xs text-muted-foreground">Optional</span>
              </div>
              <Input
                id={projectNameId}
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="e.g. Fleet Prime"
                aria-label="Project name"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium" htmlFor={directoryId}>
                  Local directory
                </label>
                <span className="text-xs text-muted-foreground">Required</span>
              </div>
              <Input
                id={directoryId}
                value={createPath}
                onChange={(event) => {
                  setCreatePath(event.target.value)
                  setDirectoryToken(undefined)
                  setDirectoryBrowser(null)
                  setDirectoryBrowseError(null)
                  setCreateSubmitError(null)
                }}
                placeholder="/absolute/path/to/project"
                aria-label="Project directory"
                aria-describedby={directoryHelpId}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="h-10 font-mono text-xs"
              />
              <p id={directoryHelpId} className="text-xs text-muted-foreground">
                Browse to select a directory, or paste an absolute path. The server validates the
                final choice before registering it.
              </p>
            </div>

            {directoryBrowseLoading && !directoryBrowser ? (
              <div
                className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <Spinner className="size-4" />
                Loading directories…
              </div>
            ) : null}

            {directoryBrowser ? (
              <div
                className="overflow-hidden rounded-xl border bg-muted/20"
                data-testid="project-directory-browser"
              >
                <div className="flex items-start gap-3 p-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FolderOpen className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Selected directory
                    </p>
                    <p
                      className="mt-1 break-all font-mono text-xs text-foreground"
                      title={selectedDirectoryPath}
                    >
                      {selectedDirectoryPath}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                    Selected
                  </span>
                </div>

                <div className="space-y-2 border-t px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Browse child directories</p>
                      <p className="text-xs text-muted-foreground">
                        Open a folder to make it the selected directory.
                      </p>
                    </div>
                    {directoryBrowser.parentToken ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={directoryBrowseLoading}
                        onClick={() =>
                          void loadDirectories({ token: directoryBrowser.parentToken ?? undefined })
                        }
                        aria-label="Go up one directory"
                        title="Go up one directory"
                      >
                        <ArrowUp className="size-3.5" />
                        Up
                      </Button>
                    ) : null}
                  </div>

                  {directoryBrowseLoading ? (
                    <div
                      className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground"
                      role="status"
                      aria-live="polite"
                    >
                      <Spinner className="size-4" />
                      Loading directories…
                    </div>
                  ) : directoryBrowser.entries.length === 0 ? (
                    <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                      No child directories here.
                    </p>
                  ) : (
                    <Combobox
                      value={directoryToken}
                      onValueChange={(token) => {
                        const entry = directoryBrowser.entries.find(
                          (candidate) => candidate.directoryToken === token,
                        )
                        if (!entry) return
                        void loadDirectories({ token })
                      }}
                    >
                      <ComboboxTrigger className="h-10 bg-background">
                        <ComboboxInput
                          aria-label="Search child directories"
                          placeholder="Choose a child directory…"
                          className="text-xs"
                        />
                      </ComboboxTrigger>
                      <ComboboxContent className="w-[min(32rem,calc(100vw-3rem))]">
                        <ComboboxList ariaLabel="Child directories">
                          <ComboboxGroup>
                            <ComboboxLabel>Child directories</ComboboxLabel>
                            {directoryBrowser.entries.map((entry) => (
                              <ComboboxItem
                                key={entry.directoryToken}
                                value={entry.directoryToken}
                                textValue={`${entry.name} ${entry.pathLabel}`}
                                keywords={[entry.pathLabel]}
                              >
                                <span className="flex min-w-0 items-start gap-2">
                                  <FolderTree className="mt-0.5 size-4 shrink-0" />
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium text-foreground">
                                      {pathEntryLabel(entry)}
                                    </span>
                                    <span
                                      className="block truncate text-[11px] text-muted-foreground"
                                      title={entry.pathLabel}
                                    >
                                      {entry.pathLabel}
                                    </span>
                                  </span>
                                </span>
                              </ComboboxItem>
                            ))}
                          </ComboboxGroup>
                          <ComboboxEmpty>No matching directories.</ComboboxEmpty>
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                  )}
                </div>
              </div>
            ) : onBrowseDirectories ? (
              <Button
                type="button"
                variant="outline"
                disabled={directoryBrowseLoading}
                onClick={() => void loadDirectories({})}
                className="w-full justify-start"
              >
                <FolderOpen className="size-4" />
                Browse directories
              </Button>
            ) : null}

            {directoryBrowseError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p>{directoryBrowseError}</p>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="mt-1 h-auto p-0 text-destructive"
                    onClick={() =>
                      void loadDirectories(
                        directoryBrowser
                          ? { token: directoryBrowser.directoryToken }
                          : {},
                      )
                    }
                  >
                    Try again
                  </Button>
                </div>
              </div>
            ) : null}

            {createSubmitError ? (
              <p className="text-sm text-destructive" role="alert">
                {createSubmitError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={createSubmitting}
              onClick={closeDialog}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSubmit || createSubmitting}
              onClick={() => void submitCreate()}
            >
              {createSubmitting ? (
                <>
                  <Spinner className="size-3.5" />
                  Adding project…
                </>
              ) : (
                <>
                  <FolderPlus className="size-3.5" />
                  Add project
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type SidebarActionDialogsProps = Pick<
  SidebarDialogsProps,
  | "projects"
  | "onRenameSession"
  | "onDeleteSession"
  | "onRenameProject"
  | "onUnregisterProject"
  | "onForkSessionIntoProject"
  | "renameTarget"
  | "setRenameTarget"
  | "renameTitle"
  | "setRenameTitle"
  | "renameProjectTarget"
  | "setRenameProjectTarget"
  | "renameProjectName"
  | "setRenameProjectName"
  | "deleteTarget"
  | "setDeleteTarget"
  | "unregisterTarget"
  | "setUnregisterTarget"
  | "forkTarget"
  | "setForkTarget"
  | "forkProjectId"
  | "setForkProjectId"
>

function FleetSessionSidebarActionDialogs({
  projects,
  onRenameSession,
  onDeleteSession,
  onRenameProject,
  onUnregisterProject,
  onForkSessionIntoProject,
  renameTarget,
  setRenameTarget,
  renameTitle,
  setRenameTitle,
  renameProjectTarget,
  setRenameProjectTarget,
  renameProjectName,
  setRenameProjectName,
  deleteTarget,
  setDeleteTarget,
  unregisterTarget,
  setUnregisterTarget,
  forkTarget,
  setForkTarget,
  forkProjectId,
  setForkProjectId,
}: SidebarActionDialogsProps) {
  return (
    <>
      <AlertDialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Rename session</AlertDialogTitle>
          <AlertDialogDescription>
            Choose a local display title for this Fleet Prime session.
          </AlertDialogDescription>
          <Input
            value={renameTitle}
            onChange={(event) => setRenameTitle(event.target.value)}
            aria-label="Session title"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!renameTitle.trim()}
              onClick={() => {
                if (renameTarget && renameTitle.trim()) {
                  onRenameSession(renameTarget.sessionId, renameTitle.trim())
                  setRenameTarget(null)
                }
              }}
            >
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={renameProjectTarget !== null}
        onOpenChange={(open) => !open && setRenameProjectTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Rename project</AlertDialogTitle>
          <AlertDialogDescription>
            This changes the display name only. The registered directory stays the same.
          </AlertDialogDescription>
          <Input
            value={renameProjectName}
            onChange={(event) => setRenameProjectName(event.target.value)}
            aria-label="Project name"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!renameProjectName.trim() || !onRenameProject}
              onClick={() => {
                if (renameProjectTarget && renameProjectName.trim()) {
                  void onRenameProject?.(
                    renameProjectTarget.projectId,
                    renameProjectName.trim(),
                  )
                  setRenameProjectTarget(null)
                }
              }}
            >
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete session?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the Fleet Prime session and its managed session artifacts. This cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) onDeleteSession(deleteTarget.sessionId)
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={unregisterTarget !== null}
        onOpenChange={(open) => !open && setUnregisterTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Unregister project?</AlertDialogTitle>
          <AlertDialogDescription>
            The directory and its sessions remain intact. Existing sessions will move to Unassigned until the directory is registered again.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (unregisterTarget) void onUnregisterProject?.(unregisterTarget.projectId)
                setUnregisterTarget(null)
              }}
            >
              Unregister
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={forkTarget !== null}
        onOpenChange={(open) => !open && setForkTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Fork session into project</DialogTitle>
            <DialogDescription>
              Create a new Fleet Prime session in another registered project.
            </DialogDescription>
          </DialogHeader>
          <select
            value={forkProjectId ?? ""}
            onChange={(event) => setForkProjectId(event.target.value || undefined)}
            className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Target project"
          >
            {projects.flatMap((project) =>
              project.projectId === forkTarget?.projectId
                ? []
                : [
                    <option key={project.projectId} value={project.projectId}>
                      {project.name} — {project.pathLabel}
                    </option>,
                  ],
            )}
          </select>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setForkTarget(null)}
              className="h-9 rounded-lg border px-3 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!forkTarget || !forkProjectId || !onForkSessionIntoProject}
              onClick={() => {
                if (!forkTarget || !forkProjectId) return
                void onForkSessionIntoProject?.(forkTarget.sessionId, forkProjectId)
                setForkTarget(null)
              }}
              className="h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            >
              Fork session
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
function FleetSessionSidebarDialogs(props: SidebarDialogsProps) {
  return (
    <>
      <FleetSessionSidebarCreateDialog {...props} />
      <FleetSessionSidebarActionDialogs {...props} />
    </>
  )
}
export function FleetSessionSidebar({
  sessions,
  projects = EMPTY_PROJECTS,
  projectSessions = sessions,
  activeProjectId,
  activeSessionId,
  onNewSession,
  onNewSessionInProject,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onProjectSelect,
  onCreateProject,
  onRenameProject,
  onUnregisterProject,
  onForkSessionIntoProject,
  onOpenPanelAction,
  onBrowseDirectories,
  accountMenu,
  onOpenSettings,
}: FleetSessionSidebarProps) {
  const {
    brandMenuOpen,
    projectActionsOpen,
    searchOpen,
    query,
    expandedProjectIds,
    revealedProjectIds,
    renameTarget,
    renameTitle,
    renameProjectTarget,
    renameProjectName,
    deleteTarget,
    unregisterTarget,
    createOpen,
    createPath,
    createName,
    directoryToken,
    directoryBrowser,
    directoryBrowseLoading,
    directoryBrowseError,
    createSubmitting,
    createSubmitError,
    forkTarget,
    forkProjectId,
    setBrandMenuOpen,
    setProjectActionsOpen,
    setSearchOpen,
    setQuery,
    setExpandedProjectIds,
    setRevealedProjectIds,
    setRenameTarget,
    setRenameTitle,
    setRenameProjectTarget,
    setRenameProjectName,
    setDeleteTarget,
    setUnregisterTarget,
    setCreateOpen,
    setCreatePath,
    setCreateName,
    setDirectoryToken,
    setDirectoryBrowser,
    setDirectoryBrowseLoading,
    setDirectoryBrowseError,
    setCreateSubmitting,
    setCreateSubmitError,
    setForkTarget,
    setForkProjectId,
  } = useFleetSessionSidebarState(activeProjectId)

  const {
    loadDirectories,
    projectById,
    sortedProjects,
    sidebarItems,
    resumeResource,
    toggleProjectResource,
    selectSearchResult,
    renderMenu,
    submitCreate,
  } = useFleetSessionSidebarViewModel({
    sessions,
    projects,
    projectSessions,
    activeProjectId,
    activeSessionId,
    onProjectSelect,
    onResumeSession,
    onCreateProject,
    onForkSessionIntoProject,
    onOpenPanelAction,
    onBrowseDirectories,
    createOpen,
    expandedProjectIds,
    revealedProjectIds,
    setExpandedProjectIds,
    setRevealedProjectIds,
    setSearchOpen,
    setDirectoryBrowser,
    setDirectoryBrowseLoading,
    setDirectoryBrowseError,
    setDirectoryToken,
    setCreatePath,
    setRenameTarget,
    setRenameTitle,
    setForkTarget,
    setForkProjectId,
    setDeleteTarget,
    setRenameProjectTarget,
    setRenameProjectName,
    setUnregisterTarget,
    createPath,
    directoryToken,
    createName,
    setCreateName,
    setCreateOpen,
    setCreateSubmitError,
    setCreateSubmitting,
  })

  return (
    <>
      <FleetSessionSidebarNavigation
        brandMenuOpen={brandMenuOpen}
        setBrandMenuOpen={setBrandMenuOpen}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        query={query}
        setQuery={setQuery}
        projectActionsOpen={projectActionsOpen}
        setProjectActionsOpen={setProjectActionsOpen}
        expandedProjectIds={expandedProjectIds}
        setExpandedProjectIds={setExpandedProjectIds}
        setCreateOpen={setCreateOpen}
        projects={projects}
        projectSessions={projectSessions}
        sidebarItems={sidebarItems}
        sortedProjects={sortedProjects}
        projectById={projectById}
        activeProjectId={activeProjectId}
        activeSessionId={activeSessionId}
        onNewSession={onNewSession}
        onNewSessionInProject={onNewSessionInProject}
        onProjectSelect={onProjectSelect}
        onRenameSession={onRenameSession}
        onCreateProject={onCreateProject}
        onOpenSettings={onOpenSettings}
        accountMenu={accountMenu}
        resumeResource={resumeResource}
        toggleProjectResource={toggleProjectResource}
        selectSearchResult={selectSearchResult}
        renderMenu={renderMenu}
      />

      <FleetSessionSidebarDialogs
        projects={projects}
        onRenameSession={onRenameSession}
        onDeleteSession={onDeleteSession}
        onRenameProject={onRenameProject}
        onUnregisterProject={onUnregisterProject}
        onForkSessionIntoProject={onForkSessionIntoProject}
        onBrowseDirectories={onBrowseDirectories}
        createOpen={createOpen}
        setCreateOpen={setCreateOpen}
        directoryBrowser={directoryBrowser}
        setDirectoryBrowser={setDirectoryBrowser}
        directoryBrowseLoading={directoryBrowseLoading}
        directoryBrowseError={directoryBrowseError}
        setDirectoryBrowseError={setDirectoryBrowseError}
        directoryToken={directoryToken}
        setDirectoryToken={setDirectoryToken}
        createName={createName}
        setCreateName={setCreateName}
        createPath={createPath}
        setCreatePath={setCreatePath}
        renameTarget={renameTarget}
        setRenameTarget={setRenameTarget}
        renameTitle={renameTitle}
        setRenameTitle={setRenameTitle}
        renameProjectTarget={renameProjectTarget}
        setRenameProjectTarget={setRenameProjectTarget}
        renameProjectName={renameProjectName}
        setRenameProjectName={setRenameProjectName}
        deleteTarget={deleteTarget}
        setDeleteTarget={setDeleteTarget}
        unregisterTarget={unregisterTarget}
        setUnregisterTarget={setUnregisterTarget}
        forkTarget={forkTarget}
        setForkTarget={setForkTarget}
        forkProjectId={forkProjectId}
        setForkProjectId={setForkProjectId}
        createSubmitting={createSubmitting}
        createSubmitError={createSubmitError}
        setCreateSubmitError={setCreateSubmitError}
        loadDirectories={loadDirectories}
        submitCreate={submitCreate}
      />
    </>
  )
}
