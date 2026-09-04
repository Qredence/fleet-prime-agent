import { useState } from "react"
import {
  History,
  Keyboard,
  Monitor,
  Moon,
  Plus,
  Square,
  Sun,
} from "lucide-react"
import { RIGHT_PANEL_LAUNCHER_DEFINITIONS } from "./layout/right-panel-registry"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../ui/command"
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol"
import type { RightPanel, ThemePreference } from "../../../lib/canvas-utils"

export type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewSession: () => void
  onStop: () => void
  onResumeSession: (session: ChatSessionInfo) => void
  onSetRightPanel: (panel: RightPanel) => void
  onThemeChange: (theme: ThemePreference) => void
  sessions: Array<ChatSessionInfo>
  isStreaming: boolean
  themePreference: ThemePreference
}

export function ChatCommandPalette({
  open,
  onOpenChange,
  onNewSession,
  onStop,
  onResumeSession,
  onSetRightPanel,
  onThemeChange,
  sessions,
  isStreaming,
  themePreference,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("")

  // Reset the query when the palette opens — prev-prop tracking during
  // render, same committed state as the old open-gated effect.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setSearch("")
  }

  const handleSelect = (callback: () => void) => {
    callback()
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command or search…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => handleSelect(onNewSession)}
            keywords={["new", "session", "chat"]}
          >
            <Plus className="mr-2 size-4" />
            <span>New session</span>
          </CommandItem>
          {isStreaming && (
            <CommandItem
              onSelect={() => handleSelect(onStop)}
              keywords={["stop", "abort", "cancel"]}
            >
              <Square className="mr-2 size-4" />
              <span>Stop generation</span>
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Panels">
          {RIGHT_PANEL_LAUNCHER_DEFINITIONS.map((definition) => {
            const Icon = definition.icon
            return (
              <CommandItem
                key={definition.id}
                onSelect={() =>
                  handleSelect(() => onSetRightPanel(definition.id))
                }
                keywords={definition.commandKeywords}
              >
                <Icon />
                <span>{definition.commandLabel}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>

        {sessions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Sessions">
              {sessions.map((session) => {
                const label = session.title
                return (
                  <CommandItem
                    key={session.sessionId}
                    onSelect={() =>
                      handleSelect(() => onResumeSession(session))
                    }
                    keywords={["session", label]}
                  >
                    <History className="mr-2 size-4" />
                    <span className="truncate">{label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Theme">
          <CommandItem
            onSelect={() => handleSelect(() => onThemeChange("light"))}
            keywords={["theme", "light"]}
          >
            <Sun className="mr-2 size-4" />
            <span>Light</span>
            {themePreference === "light" && (
              <Keyboard className="ml-auto size-3 opacity-50" />
            )}
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => onThemeChange("dark"))}
            keywords={["theme", "dark"]}
          >
            <Moon className="mr-2 size-4" />
            <span>Dark</span>
            {themePreference === "dark" && (
              <Keyboard className="ml-auto size-3 opacity-50" />
            )}
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => onThemeChange("system"))}
            keywords={["theme", "system"]}
          >
            <Monitor className="mr-2 size-4" />
            <span>System</span>
            {themePreference === "system" && (
              <Keyboard className="ml-auto size-3 opacity-50" />
            )}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
