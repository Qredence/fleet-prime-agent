"use client";

import { AlertCircle, Clock3, Gauge, ListRestart, RotateCcw } from "lucide-react";
import { m, useReducedMotion } from "motion/react";

import { AgentProgress } from "@prime-agent/web-design/components/registry/beui/agents/loading-states/agent-progress";
import { cn } from "@prime-agent/web-design/lib/utils";

export type FleetTurnStatusKind =
  | "queue"
  | "retry"
  | "compaction"
  | "recovery"
  | "notice";

/** Fleet-owned lifecycle copy around the installed beUI AgentProgress primitive. */
export function FleetTurnStatus({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  if (!label?.trim()) return null;
  const { kind, title, detail } = describeTurnStatus(label);
  const Icon = iconFor(kind);
  const liveProgress = kind === "queue" || kind === "retry" || kind === "compaction";

  return (
    <m.div
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
      transition={{ duration: reduceMotion ? 0 : 0.16 }}
      role={kind === "recovery" ? "status" : undefined}
      aria-live={kind === "recovery" ? "polite" : "off"}
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border/60 bg-muted/45 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      {liveProgress ? (
        <AgentProgress label={title} running className="min-w-0 text-xs" />
      ) : (
        <>
          <Icon className={cn("mt-0.5 size-3.5 shrink-0", kind === "recovery" && "text-amber-600 dark:text-amber-400")} />
          <strong className="font-medium text-foreground/90">{title}</strong>
        </>
      )}
      {detail ? <span className="min-w-0 leading-relaxed">{detail}</span> : null}
    </m.div>
  );
}

function describeTurnStatus(label: string): {
  kind: FleetTurnStatusKind;
  title: string;
  detail?: string;
} {
  const normalized = label.trim();
  const lower = normalized.toLowerCase();
  if (lower.includes("queued") || lower.includes("steered")) {
    return { kind: "queue", title: "Queued work", detail: normalized };
  }
  if (lower.includes("retry")) {
    return { kind: "retry", title: "Retrying safely", detail: normalized };
  }
  if (lower.includes("compact")) {
    return { kind: "compaction", title: "Managing context", detail: normalized };
  }
  if (lower.includes("reset") || lower.includes("recover") || lower.includes("sign in")) {
    return { kind: "recovery", title: "Run needs attention", detail: normalized };
  }
  return { kind: "notice", title: "Run update", detail: normalized };
}

function iconFor(kind: FleetTurnStatusKind) {
  switch (kind) {
    case "queue":
      return ListRestart;
    case "retry":
      return RotateCcw;
    case "compaction":
      return Gauge;
    case "recovery":
      return AlertCircle;
    default:
      return Clock3;
  }
}
