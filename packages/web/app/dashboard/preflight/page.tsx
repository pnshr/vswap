"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOperator } from "@/lib/operator-context";
import { DEMO_CONFIG, DEMO_PREFLIGHT, buildLivePreflightStubs } from "@/lib/demo";
import type { CheckStatus, OperatorConfigMetadata, OperatorPeer, PreflightCheck } from "@/lib/types";
import { parseOperatorSecret, runPreflight as runProxyPreflight } from "@/lib/agent-client";

const DOCS: Record<string, string> = {
  "validator-running": "https://github.com/pnshr/vswap#preflight-validator",
  "caught-up": "https://github.com/pnshr/vswap#preflight-catchup",
  "tower-present": "https://github.com/pnshr/vswap#preflight-tower",
  "identity-symlink": "https://github.com/pnshr/vswap#preflight-identity",
  "authorized-voter": "https://github.com/pnshr/vswap#preflight-voter",
  "unstaked-identity": "https://github.com/pnshr/vswap#preflight-unstaked",
  "tmpfs-base": "https://github.com/pnshr/vswap#preflight-tmpfs",
  "disk-pressure": "https://github.com/pnshr/vswap#preflight-disk",
};

interface NodeResult {
  peer: OperatorPeer;
  checks: PreflightCheck[];
  ranAt: number;
}

export default function PreflightPage() {
  const { mode, config, unlockedSecret } = useOperator();
  const effectiveConfig: OperatorConfigMetadata = config ?? DEMO_CONFIG;
  const isDemo = mode === "demo" || !config;
  const secret = useMemo(() => parseOperatorSecret(unlockedSecret), [unlockedSecret]);
  const [results, setResults] = useState<NodeResult[]>(initial(effectiveConfig, isDemo));
  const [running, setRunning] = useState(false);

  function rerun() {
    setRunning(true);
    if (!isDemo && secret === null) {
      window.setTimeout(() => {
        setResults(initial(effectiveConfig, isDemo));
        setRunning(false);
      }, 600);
      return;
    }
    Promise.all(
      effectiveConfig.peers.map(async (peer, idx) => {
        try {
          const role = idx === 0 ? "source" : "target";
          const response = await runProxyPreflight(
            { ...peer, sandbox: isDemo, ...(secret !== null ? { secret } : {}) },
            role,
          );
          return { peer, checks: response.checks, ranAt: Date.now() };
        } catch (err) {
          return {
            peer,
            checks: [
              {
                status: "fail" as const,
                name: "sandbox-api",
                message: err instanceof Error ? err.message : String(err),
              },
            ],
            ranAt: Date.now(),
          };
        }
      }),
    ).then((next) => {
      setResults(next);
      setRunning(false);
    });
  }

  const summary = useMemo(() => summarise(results), [results]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Preflight</h1>
          <p className="text-sm text-muted-foreground">
            Per-node checks. The dashboard refuses to start a swap if any check is{" "}
            <span className="text-destructive">fail</span>; warnings are advisory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={rerun} disabled={running}>
            <RefreshCw className={running ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Re-run
          </Button>
          <Link href="/dashboard/swap">
            <Button disabled={summary.fail > 0}>
              Continue to swap <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-4 text-sm">
          <Stat label="ok" value={summary.ok} tone="success" />
          <Stat label="warn" value={summary.warn} tone="warning" />
          <Stat label="fail" value={summary.fail} tone="destructive" />
          <span className="text-muted-foreground">
            {summary.fail > 0
              ? "Resolve failing checks before starting a swap."
              : summary.warn > 0
                ? "Warnings are advisory. Review before proceeding."
                : "All checks green."}
          </span>
        </CardContent>
      </Card>

      {mode === "demo" ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Badge tone="warning">sandbox data</Badge>
            <span className="text-muted-foreground">
              Results come from the hosted disposable validator sandbox. Self-hosted live mode can target real agents.
            </span>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {results.map((r) => (
          <NodeChecks key={r.peer.id} result={r} />
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "destructive";
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge tone={tone}>{label}</Badge>
      <span className="font-mono text-base">{value}</span>
    </div>
  );
}

function NodeChecks({ result }: { result: NodeResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          {result.peer.label}
        </CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          {result.peer.host}:{result.peer.port} · last run {new Date(result.ranAt).toLocaleTimeString()}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {result.checks.map((c) => (
            <li
              key={c.name}
              className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 p-3"
            >
              <div className="flex items-start gap-2">
                <Icon status={c.status} />
                <div>
                  <div className="font-mono text-sm">{c.name}</div>
                  <p className="text-xs text-muted-foreground">{c.message}</p>
                </div>
              </div>
              {c.status !== "ok" && DOCS[c.name] ? (
                <a
                  href={DOCS[c.name]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <BookOpen className="h-3 w-3" /> learn more
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Icon({ status }: { status: CheckStatus }) {
  if (status === "ok") return <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />;
  if (status === "warn") return <ShieldAlert className="mt-0.5 h-4 w-4 text-warning" />;
  return <XCircle className="mt-0.5 h-4 w-4 text-destructive" />;
}

function summarise(results: NodeResult[]) {
  let ok = 0;
  let warn = 0;
  let fail = 0;
  for (const r of results) {
    for (const c of r.checks) {
      if (c.status === "ok") ok += 1;
      else if (c.status === "warn") warn += 1;
      else fail += 1;
    }
  }
  return { ok, warn, fail };
}

function initial(config: OperatorConfigMetadata, isDemo: boolean): NodeResult[] {
  return config.peers.map((peer) => ({
    peer,
    checks: isDemo
      ? DEMO_PREFLIGHT[peer.id] ?? buildLivePreflightStubs(peer.id)
      : buildLivePreflightStubs(peer.id),
    ranAt: Date.now(),
  }));
}
