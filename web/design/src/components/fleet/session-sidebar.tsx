import {
  BookOpenText,
  ChevronDown,
  CircleHelp,
  CircleStop,
  Folder,
  FolderPlus,
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
import { useCallback, useEffect, useMemo, useReducer } from "react"
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
import { Popover } from "../agent-elements/input/popover"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../dialog"
import { Input } from "../input"
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
  return session.title || session.firstMessage || session.sessionId.slice(0, 8)
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
    setForkTarget,
    setForkProjectId,
  }
}

type SidebarStateView = ReturnType<typeof useFleetSessionSidebarState>
type SidebarViewModelState = Pick<
  SidebarStateView,
  | "createOpen"
  | "directoryBrowser"
  | "expandedProjectIds"
  | "revealedProjectIds"
  | "setExpandedProjectIds"
  | "setRevealedProjectIds"
  | "setSearchOpen"
  | "setDirectoryBrowser"
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
  directoryBrowser,
  expandedProjectIds,
  revealedProjectIds,
  setExpandedProjectIds,
  setRevealedProjectIds,
  setSearchOpen,
  setDirectoryBrowser,
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
}: SidebarViewModelOptions) {
  const loadDirectories = useCallback(
    async (input: { path?: string; token?: string }) => {
      if (!onBrowseDirectories) return
      const response = await onBrowseDirectories(input)
      setDirectoryBrowser(response)
      setDirectoryToken(response.directoryToken)
      setCreatePath(response.pathLabel)
    },
    [onBrowseDirectories, setCreatePath, setDirectoryBrowser, setDirectoryToken],
  )

  useEffect(() => {
    if (!createOpen || !onBrowseDirectories || directoryBrowser) return
    void loadDirectories({}).catch(() => undefined)
  }, [createOpen, directoryBrowser, loadDirectories, onBrowseDirectories])

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

  const submitCreate = () => {
    const path = createPath.trim()
    if (!onCreateProject || (!path && !directoryToken)) return
    void Promise.resolve(
      onCreateProject({
        path: directoryToken ? undefined : path,
        directoryToken,
        name: createName.trim() || undefined,
      }),
    ).then(() => {
      setCreateOpen(false)
      setCreatePath("")
      setCreateName("")
      setDirectoryToken(undefined)
      setDirectoryBrowser(null)
    })
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
                description="Choose a local directory for Prime Agent."
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
              <Combobox
                open
                query={query}
                onQueryChange={setQuery}
                onValueChange={selectSearchResult}
              >
                <ComboboxTrigger
                  showIndicator={false}
                  className="h-9 min-w-0 rounded-none border-0 border-b bg-transparent px-2 shadow-none"
                >
                  <ComboboxInput
                    aria-label="Search projects and sessions"
                    placeholder="Search projects and sessions"
                    wrapperClassName="gap-2"
                    className="h-8 text-xs"
                  />
                </ComboboxTrigger>
                <ComboboxList ariaLabel="Project and session search">
                  <ComboboxGroup>
                    <ComboboxLabel>Projects</ComboboxLabel>
                    {sortedProjects.map((project) => (
                      <ComboboxItem
                        key={project.projectId}
                        value={`search-project:${project.projectId}`}
                        textValue={project.name}
                        keywords={[project.pathLabel]}
                      >
                        <Folder className="size-4 shrink-0" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{project.name}</span>
                          <span className="truncate text-[11px] text-muted-foreground">
                            {project.pathLabel}
                          </span>
                        </span>
                      </ComboboxItem>
                    ))}
                  </ComboboxGroup>
                  <ComboboxGroup>
                    <ComboboxLabel>Sessions</ComboboxLabel>
                    {sortSessions(projectSessions).map((session) => (
                      <ComboboxItem
                        key={session.sessionId}
                        value={`search-session:${session.sessionId}`}
                        textValue={sessionLabel(session)}
                        keywords={[
                          session.firstMessage,
                          session.projectId
                            ? (projectById.get(session.projectId)?.name ?? "")
                            : "Unassigned",
                        ]}
                      >
                        <span className="min-w-0 truncate">{sessionLabel(session)}</span>
                      </ComboboxItem>
                    ))}
                  </ComboboxGroup>
                  <ComboboxEmpty>No matching projects or sessions.</ComboboxEmpty>
                </ComboboxList>
              </Combobox>
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
  > &
  { projects: Array<ProjectSummary> } &
  Pick<
    SidebarStateView,
    | "createOpen"
    | "setCreateOpen"
    | "directoryBrowser"
    | "setDirectoryBrowser"
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
  > & {
    loadDirectories: (input: { path?: string; token?: string }) => Promise<void>
    submitCreate: () => void
  }

type SidebarCreateDialogProps = Pick<
  SidebarDialogsProps,
  | "createOpen"
  | "setCreateOpen"
  | "directoryBrowser"
  | "setDirectoryBrowser"
  | "directoryToken"
  | "setDirectoryToken"
  | "createName"
  | "setCreateName"
  | "createPath"
  | "setCreatePath"
  | "loadDirectories"
  | "submitCreate"
>

function FleetSessionSidebarCreateDialog({
  createOpen,
  setCreateOpen,
  directoryBrowser,
  setDirectoryBrowser,
  directoryToken,
  setDirectoryToken,
  createName,
  setCreateName,
  createPath,
  setCreatePath,
  loadDirectories,
  submitCreate,
}: SidebarCreateDialogProps) {
  return (
    <>
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            setDirectoryBrowser(null)
            setDirectoryToken(undefined)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription>
              Register a local directory. Prime Agent keeps the canonical path on the server.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Project name (optional)"
              aria-label="Project name"
            />
            <Input
              value={createPath}
              onChange={(event) => {
                setCreatePath(event.target.value)
                setDirectoryToken(undefined)
              }}
              placeholder="/path/to/project"
              aria-label="Project directory"
            />
            {directoryBrowser ? (
              <div className="rounded-xl border bg-muted/20 p-2">
                {(() => {
                  const parentToken = directoryBrowser.parentToken
                  return (
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{directoryBrowser.pathLabel}</span>
                  {parentToken ? (
                    <button
                      type="button"
                      onClick={() => void loadDirectories({ token: parentToken })}
                      className="rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                    >
                      Up
                    </button>
                  ) : null}
                </div>
                  )
                })()}
                <Combobox
                  value={directoryToken}
                  onValueChange={(token) => {
                    const entry = directoryBrowser.entries.find(
                      (candidate) => candidate.directoryToken === token,
                    )
                    if (!entry) return
                    void loadDirectories({ token }).catch(() => undefined)
                  }}
                >
                  <ComboboxTrigger className="h-9 bg-background">
                    <ComboboxInput
                      aria-label="Search directories"
                      placeholder="Browse directories"
                      className="text-xs"
                    />
                  </ComboboxTrigger>
                  <ComboboxContent className="w-[min(28rem,calc(100vw-3rem))]">
                    <ComboboxList ariaLabel="Directories">
                      <ComboboxGroup>
                        <ComboboxLabel>Directories</ComboboxLabel>
                        {directoryBrowser.entries.map((entry) => (
                          <ComboboxItem
                            key={entry.directoryToken}
                            value={entry.directoryToken}
                            textValue={`${entry.name} ${entry.pathLabel}`}
                            keywords={[entry.pathLabel]}
                          >
                            <span className="flex items-center gap-2">
                              <FolderTree className="size-4" />
                              <span className="truncate">{pathEntryLabel(entry)}</span>
                            </span>
                          </ComboboxItem>
                        ))}
                      </ComboboxGroup>
                      <ComboboxEmpty>No directories found.</ComboboxEmpty>
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="h-9 rounded-lg border px-3 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!directoryToken && !createPath.trim().startsWith("/")}
              onClick={submitCreate}
              className="h-9 rounded-lg bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            >
              Add project
            </button>
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
            Choose a local display title for this Prime Agent session.
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
            This removes the Prime Agent session and its managed session artifacts. This cannot be undone.
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
              Create a new Prime Agent session in another registered project.
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
    directoryBrowser,
    expandedProjectIds,
    revealedProjectIds,
    setExpandedProjectIds,
    setRevealedProjectIds,
    setSearchOpen,
    setDirectoryBrowser,
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
        createOpen={createOpen}
        setCreateOpen={setCreateOpen}
        directoryBrowser={directoryBrowser}
        setDirectoryBrowser={setDirectoryBrowser}
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
        loadDirectories={loadDirectories}
        submitCreate={submitCreate}
      />
    </>
  )
}
