import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "muted" | "success" | "warning" | "destructive" | "outline";

const tones: Record<Tone, string> = {
  default: "bg-primary text-primary-foreground border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  outline: "bg-transparent text-foreground border-border",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "default", ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
