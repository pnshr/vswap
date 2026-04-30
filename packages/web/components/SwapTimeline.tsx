import { cn } from "@/lib/utils";
import { ALL_PHASES, PHASE_LABEL, type SwapPhase } from "@/lib/types";

export type StepState = "upcoming" | "current" | "done" | "failed";

interface Step {
  phase: SwapPhase;
  state: StepState;
  /** Optional duration in ms once the step has settled. */
  durationMs?: number;
}

interface Props {
  steps?: Step[];
  /** When provided without `steps`, builds an "upcoming" timeline. */
  preview?: boolean;
}

export function SwapTimeline({ steps, preview = false }: Props) {
  const resolved: Step[] =
    steps ??
    ALL_PHASES.map((phase) => ({
      phase,
      state: preview ? "upcoming" : "upcoming",
    }));

  return (
    <div role="list" className="relative">
      <div className="absolute left-[15px] top-3 bottom-3 w-px bg-border" aria-hidden />
      <ol className="space-y-4">
        {resolved.map((step, idx) => (
          <li
            key={step.phase}
            role="listitem"
            className="relative flex items-start gap-4"
          >
            <span
              className={cn(
                "relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
                step.state === "done" &&
                  "border-success bg-success/15 text-success",
                step.state === "current" &&
                  "border-primary bg-primary text-primary-foreground animate-soft-pulse",
                step.state === "upcoming" &&
                  "border-border bg-card text-muted-foreground",
                step.state === "failed" &&
                  "border-destructive bg-destructive/15 text-destructive",
              )}
            >
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    step.state === "upcoming" && "text-muted-foreground",
                    step.state === "failed" && "text-destructive",
                  )}
                >
                  {PHASE_LABEL[step.phase]}
                </span>
                {step.durationMs !== undefined ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {step.durationMs}ms
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                {hint(step.phase)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function hint(phase: SwapPhase): string {
  switch (phase) {
    case "precheck":
      return "verify catchup, tower presence, identity symlink";
    case "stop-voting":
      return "setIdentity(unstaked) on source, capture last voted slot";
    case "ship-tower":
      return "seal identity + tower against target session pubkey";
    case "activate":
      return "setIdentity(staked, requireTower=true) on target";
    case "cleanup":
      return "scrub tmpfs session dir on both sides";
    case "health":
      return "wait for first voted slot on target";
  }
}
