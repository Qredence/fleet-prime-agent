"use client";

import { useEffect, useMemo, useState } from "react";

import type { ChatReasoningPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { GenerationLoader } from "@prime-agent/web-design/components/elements/loading-state";
import { ThinkingIndicator } from "@prime-agent/web-design/components/elements/thinking-indicator";
import { ReasoningPanel } from "@prime-agent/web-design/components/elements/reasoning-panel";
import { cn } from "@prime-agent/web-design/lib/utils";

/**
 * Fleet-owned safety adapter for the official Assistant UI Elements ReasoningPanel.
 * It accepts only the adapter's controlled ChatReasoningPresentation—never raw model
 * thought, provider traces, tool inputs, or diagnostic payloads.
 */
export function FleetReasoningPanel({
  presentation,
  className,
}: {
  presentation: ChatReasoningPresentation;
  className?: string;
}) {
  const [open, setOpen] = useState(presentation.streaming);
  const steps = useMemo(
    () => presentation.steps.map((step) => ({ title: step.title, body: step.body })),
    [presentation.steps],
  );
  const visibleSteps = Math.min(Math.max(0, presentation.visibleSteps), steps.length);
  const activeStep = steps.at(visibleSteps - 1);
  const activeLabel = activeStep?.title ?? phaseLabel(presentation.phase);
  const elapsed = formatElapsed(presentation.elapsedMs);

  useEffect(() => {
    if (presentation.streaming) setOpen(true);
  }, [presentation.streaming, presentation.visibleSteps]);

  return (
    <section
      data-slot="fleet-reasoning-presentation"
      aria-label="Safe reasoning progress"
      className={cn(
        "w-full max-w-xl rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 shadow-sm shadow-black/[0.02] dark:shadow-black/15",
        className,
      )}
    >
      {presentation.streaming ? (
        <div className="mb-1.5 flex flex-col gap-1.5 border-b border-border/45 pb-2.5">
          {activeStep?.body ? (
            <>
              <ThinkingIndicator label={activeLabel} elapsed={elapsed} className="text-[13px]" />
              <p className="pl-4 text-xs font-normal text-muted-foreground">
                {activeStep.body}
              </p>
            </>
          ) : (
            <GenerationLoader
              label={activeLabel}
              tick={Math.floor((presentation.elapsedMs ?? 0) / 250)}
              variant="dots"
              className="items-start gap-2 px-1 py-1 text-left"
            />
          )}
        </div>
      ) : null}
      <ReasoningPanel
        steps={steps}
        visibleSteps={visibleSteps}
        streaming={presentation.streaming}
        streamingLabel="Preparing response"
        open={open}
        onOpenChange={setOpen}
        restingLabel={presentation.restingLabel}
        elapsed={elapsed}
        className="max-w-none"
      />
    </section>
  );
}

function phaseLabel(phase: string) {
  switch (phase) {
    case "waiting":
      return "Preparing run";
    case "context":
      return "Reviewing workspace context";
    case "planning":
      return "Organising the response";
    case "executing":
      return "Completing requested work";
    case "responding":
      return "Writing the response";
    case "recovering":
      return "Recovering the run";
    case "error":
      return "Run needs attention";
    case "complete":
      return "Completed";
    default:
      return "Working";
  }
}

function formatElapsed(elapsedMs: number | undefined) {
  if (elapsedMs === undefined) return undefined;
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return String(seconds) + "s";
  return String(Math.floor(seconds / 60)) + "m " + String(seconds % 60) + "s";
}
