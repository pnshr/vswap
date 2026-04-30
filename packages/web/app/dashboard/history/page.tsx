"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Download, History as HistoryIcon, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PubkeyBadge } from "@/components/PubkeyBadge";
import { useOperator } from "@/lib/operator-context";
import { clearHistory, loadHistory } from "@/lib/storage";
import { DEMO_HISTORY } from "@/lib/demo";
import type { SwapHistoryEntry } from "@/lib/types";
import { formatDuration, formatRelative, formatTimestamp } from "@/lib/utils";

export default function HistoryPage() {
  const { mode } = useOperator();
  const [entries, setEntries] = useState<SwapHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await loadHistory();
      if (stored.length === 0 && mode === "demo") {
        setEntries(DEMO_HISTORY);
      } else {
        setEntries(stored);
      }
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, [mode]);

  const downloadUrl = useMemo(() => {
    if (typeof window === "undefined") return "#";
    return URL.createObjectURL(
      new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" }),
    );
  }, [entries]);

  useEffect(() => {
    return () => {
      if (downloadUrl !== "#") URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  async function onClear() {
    await clearHistory();
    setEntries([]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Swap history</h1>
          <p className="text-sm text-muted-foreground">
            Stored locally in this browser&apos;s IndexedDB. No history is sent to the dashboard server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={downloadUrl}
            download="vswap-history.json"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" /> Export JSON
          </a>
          <Button variant="outline" onClick={onClear} disabled={entries.length === 0}>
            <Trash2 className="h-4 w-4" /> Clear
          </Button>
        </div>
      </div>

      {mode === "demo" ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <Badge tone="warning">demo data</Badge>
            <span className="text-muted-foreground">
              Real swaps you run from this browser are appended below.
            </span>
          </CardContent>
        </Card>
      ) : null}

      {!loaded ? null : entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <HistoryIcon className="h-6 w-6" />
            <p>No swaps recorded yet.</p>
            <Link href="/dashboard/swap">
              <Button>
                Start a swap <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <Card key={e.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  {e.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : e.status === "rolled-back" ? (
                    <RotateCcw className="h-4 w-4 text-warning" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="font-mono">{e.id}</span>
                </CardTitle>
                <div className="text-xs text-muted-foreground" title={formatTimestamp(e.startedAt)}>
                  {formatRelative(e.startedAt)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 text-sm">
                  <Stat label="Direction" value={`${e.fromNodeId} → ${e.toNodeId}`} />
                  <Stat label="Duration" value={formatDuration(e.durationMs)} />
                  <Stat
                    label="Source last voted"
                    value={
                      e.sourceLastVotedSlot !== undefined
                        ? e.sourceLastVotedSlot.toLocaleString()
                        : "—"
                    }
                    mono
                  />
                  <Stat
                    label="Target first voted"
                    value={
                      e.targetFirstVotedSlot !== undefined
                        ? e.targetFirstVotedSlot.toLocaleString()
                        : "—"
                    }
                    mono
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>identity</span>
                  <PubkeyBadge pubkey={e.fromIdentity} />
                  {e.failureReason ? (
                    <span className="ml-auto text-destructive">{e.failureReason}</span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</div>
    </div>
  );
}
