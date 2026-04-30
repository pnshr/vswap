import { cn } from "@/lib/utils";
import { PHASE_LABEL, type SwapProgress } from "@/lib/types";

interface Props {
  events: SwapProgress[];
  className?: string;
}

export function ProgressStream({ events, className }: Props) {
  return (
    <div
      className={cn(
        "max-h-72 overflow-y-auto rounded-md border border-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/85 scanline",
        className,
      )}
      role="log"
      aria-live="polite"
    >
      {events.length === 0 ? (
        <div className="text-muted-foreground">— no events yet —</div>
      ) : (
        <ol>
          {events.map((ev, i) => (
            <li key={`${ev.sessionId}-${i}-${ev.ts}`} className="grid grid-cols-[88px_1fr] gap-3">
              <span className="text-muted-foreground">
                {new Date(ev.ts).toISOString().slice(11, 19)}
              </span>
              <span>
                <span className="text-success">{PHASE_LABEL[ev.phase]}</span>
                <span className="text-muted-foreground"> :: </span>
                <span>{ev.detail}</span>
                {ev.slot !== undefined ? (
                  <span className="text-muted-foreground">
                    {" "}
                    [slot {ev.slot.toLocaleString()}]
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
