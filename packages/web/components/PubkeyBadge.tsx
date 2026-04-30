"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn, shortPubkey } from "@/lib/utils";

interface Props {
  pubkey: string;
  className?: string;
  /** Render the full pubkey instead of truncating. */
  full?: boolean;
}

export function PubkeyBadge({ pubkey, className, full = false }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(pubkey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable; ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={pubkey}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-foreground transition-colors hover:bg-muted",
        className,
      )}
    >
      <span className="select-all">{full ? pubkey : shortPubkey(pubkey)}</span>
      {copied ? (
        <Check className="h-3 w-3 text-success" aria-label="copied" />
      ) : (
        <Copy
          className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-foreground"
          aria-label="copy"
        />
      )}
    </button>
  );
}
