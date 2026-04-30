"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  GitBranch,
  PlayCircle,
  Repeat,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ConfirmWithWord } from "@/components/ConfirmWithWord";
import { PlanDiff } from "@/components/PlanDiff";
import { ProgressStream } from "@/components/ProgressStream";
import { SwapTimeline, type StepState } from "@/components/SwapTimeline";
import { PubkeyBadge } from "@/components/PubkeyBadge";
import { useOperator } from "@/lib/operator-context";
import {
  DEMO_CONFIG,
  DEMO_NODE_STATUS,
  DEMO_PREFLIGHT,
  buildLiveNodeStubs,
  buildLivePreflightStubs,
} from "@/lib/demo";
import { ALL_PHASES, PHASE_LABEL, type SwapPhase, type SwapProgress } from "@/lib/types";
import { appendHistory } from "@/lib/storage";
import { formatDuration } from "@/lib/utils";
import {
  executeSwap as executeProxySwap,
  fetchStatus,
  parseOperatorSecret,
} from "@/lib/agent-client";

type Step = "direction" | "preflight" | "plan" | "confirm" | "execute" | "result";
type Outcome = "completed" | "failed" | "rolled-back";
type RunMode = "live" | "dry-run";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "direction", label: "Direction" },
  { id: "preflight", label: "Preflight" },
  { id: "plan", label: "Plan" },
  { id: "confirm", label: "Confirm" },
  { id: "execute", label: "Execute" },
  { id: "result", label: "Result" },
];

interface SwapResultData {
  outcome: Outcome;
  runMode: RunMode;
  events: SwapProgress[];
  totalMs: number;
  stepDurations: Partial<Record<SwapPhase, number>>;
  finalIdentity: string;
  failureReason?: string;
}

export default function SwapPage() {
  const { config, mode, unlockedSecret } = useOperator();
  const effectiveConfig = config ?? DEMO_CONFIG;
  const peers = effectiveConfig.peers;
  const isDemo = mode === "demo" || !config;
  const secret = useMemo(() => parseOperatorSecret(unlockedSecret), [unlockedSecret]);

  const baseNodes = useMemo(
    () => (isDemo ? DEMO_NODE_STATUS : buildLiveNodeStubs(peers)),
    [isDemo, peers],
  );
  const [nodes, setNodes] = useState(baseNodes);

  useEffect(() => {
    setNodes(baseNodes);
    const statusPeers = isDemo
      ? peers.map((peer) => ({ ...peer, sandbox: true }))
      : secret !== null
        ? peers.map((peer) => ({ ...peer, secret }))
        : [];
    if (statusPeers.length === 0) return;
    Promise.all(statusPeers.map((peer) => fetchStatus(peer).then((response) => response.status)))
      .then(setNodes)
      .catch(() => setNodes(baseNodes));
  }, [baseNodes, isDemo, peers, secret]);

  const [step, setStep] = useState<Step>("direction");
  const [fromId, setFromId] = useState<string>(peers[0]?.id ?? "primary");
  const [toId, setToId] = useState<string>(peers[1]?.id ?? "standby");
  const [confirmed, setConfirmed] = useState(false);
  const requireTower = true;
  const [result, setResult] = useState<SwapResultData | null>(null);
  const [progress, setProgress] = useState<SwapProgress[]>([]);
  const [stepStates, setStepStates] = useState<Record<SwapPhase, StepState>>(initialStepStates());
  const [runMode, setRunMode] = useState<RunMode>("live");
  const [cancelRun, setCancelRun] = useState<(() => void) | null>(null);

  const fromPeer = peers.find((p) => p.id === fromId);
  const toPeer = peers.find((p) => p.id === toId);
  const fromNode = nodes.find((n) => n.id === fromId);
  const toNode = nodes.find((n) => n.id === toId);

  function checksFor(id: string) {
    if (isDemo) return DEMO_PREFLIGHT[id] ?? buildLivePreflightStubs(id);
    return buildLivePreflightStubs(id);
  }

  const preflightFails = useMemo(() => {
    const all = [...checksFor(fromId), ...checksFor(toId)];
    return all.filter((c) => c.status === "fail").length;
    // checksFor is stable across renders for fixed isDemo/peer ids; recompute
    // when those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, fromId, toId]);

  const auditUrl = useMemo(() => {
    if (!result || typeof window === "undefined") return null;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    return URL.createObjectURL(blob);
  }, [result]);

  useEffect(() => {
    return () => {
      if (auditUrl) URL.revokeObjectURL(auditUrl);
    };
  }, [auditUrl]);

  // The word-confirmation gate must re-arm any time the operator leaves
  // the confirm step. ConfirmWithWord's input is local state and resets
  // on remount, but the parent's `confirmed` flag would otherwise persist
  // and let an empty input enable Execute swap.
  useEffect(() => {
    if (step !== "confirm") setConfirmed(false);
  }, [step]);

  function reset() {
    cancelRun?.();
    setCancelRun(null);
    setStep("direction");
    setConfirmed(false);
    setResult(null);
    setProgress([]);
    setStepStates(initialStepStates());
    setRunMode("live");
  }

  function abortRun() {
    cancelRun?.();
    setCancelRun(null);
    setStep("plan");
    setProgress([]);
    setStepStates(initialStepStates());
  }

  function startExecute(opts: { dryRun: boolean }) {
    if (fromId === toId || !fromPeer || !toPeer) return;
    setRunMode(opts.dryRun ? "dry-run" : "live");
    setStep("execute");
    setProgress([]);
    setStepStates(initialStepStates());
    let cancelled = false;
    let cancelReplay: (() => void) | null = null;
    setCancelRun(() => () => {
      cancelled = true;
      cancelReplay?.();
    });
    executeProxySwap({
      source: { ...fromPeer, sandbox: isDemo, ...(secret !== null ? { secret } : {}) },
      target: { ...toPeer, sandbox: isDemo, ...(secret !== null ? { secret } : {}) },
      expectedPubkey: fromNode?.identityPubkey ?? "",
      requireTower,
      dryRun: opts.dryRun,
    }).then((swap) => {
      if (cancelled) return;
      cancelReplay = replayEvents(swap.events, {
      onEvent(ev, idx) {
        setProgress((p) => [...p, ev]);
        setStepStates((prev) => {
          const next = { ...prev };
          next[ev.phase] = "current";
          if (idx > 0) {
            const previous = ALL_PHASES[idx - 1];
            if (previous) next[previous] = "done";
          }
          return next;
        });
      },
      onDone(events) {
        setCancelRun(null);
        const last = ALL_PHASES[ALL_PHASES.length - 1];
        setStepStates((prev) => {
          const next = { ...prev };
          for (const phase of ALL_PHASES) next[phase] = "done";
          if (last) next[last] = "done";
          return next;
        });
        const totalMs = events.length > 0 ? events[events.length - 1]!.ts - events[0]!.ts : 0;
        const stepDurations: Partial<Record<SwapPhase, number>> = {};
        for (let i = 0; i < events.length - 1; i++) {
          const cur = events[i]!;
          const nxt = events[i + 1]!;
          stepDurations[cur.phase] = nxt.ts - cur.ts;
        }
        const final = fromNode?.identityPubkey ?? "";
        const data: SwapResultData = {
          outcome: "completed",
          runMode: opts.dryRun ? "dry-run" : "live",
          events,
          totalMs: swap.durationMs || totalMs,
          stepDurations,
          finalIdentity: swap.finalIdentity || final,
        };
        setResult(data);
        setStep("result");
        if (!opts.dryRun) {
          void appendHistory({
            id: `swap-${Date.now()}`,
            startedAt: events[0]?.ts ?? Date.now(),
            durationMs: swap.durationMs || totalMs,
            fromNodeId: fromId,
            toNodeId: toId,
            fromIdentity: fromNode?.identityPubkey ?? "",
            toIdentity: swap.finalIdentity || final,
            status: "completed",
            sourceLastVotedSlot: (events[1]?.slot ?? 0),
            targetFirstVotedSlot: (events[events.length - 1]?.slot ?? 0),
            towerAdvancement:
              (events[events.length - 1]?.slot ?? 0) - (events[1]?.slot ?? 0),
          });
        }
      },
      });
    }).catch((err) => {
      if (cancelled) return;
      setCancelRun(null);
      const message = err instanceof Error ? err.message : String(err);
      const failed: SwapProgress = {
        sessionId: `failed-${Date.now()}`,
        phase: "cleanup",
        detail: message,
        ts: Date.now(),
      };
      setProgress([failed]);
      setStepStates((prev) => ({ ...prev, cleanup: "failed" }));
      setResult({
        outcome: "failed",
        runMode: opts.dryRun ? "dry-run" : "live",
        events: [failed],
        totalMs: 0,
        stepDurations: {},
        finalIdentity: fromNode?.identityPubkey ?? "",
        failureReason: message,
      });
      setStep("result");
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Swap identity</h1>
          <p className="text-sm text-muted-foreground">
            A 1–3 second downtime swap. Dry-run is always available; the real swap requires word
            confirmation.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {mode === "demo" ? <Badge tone="warning">sandbox</Badge> : null}
          <Link href="/dashboard">
            <Button variant="ghost">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
        </div>
      </div>

      <Stepper current={step} />

      {step === "direction" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 1 · select direction</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <SelectField
              label="From (current primary)"
              value={fromId}
              onChange={setFromId}
              options={peers.map((p) => ({ value: p.id, label: p.label }))}
            />
            <SelectField
              label="To (target)"
              value={toId}
              onChange={setToId}
              options={peers.map((p) => ({ value: p.id, label: p.label }))}
            />
            <div className="md:col-span-2 flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-success" />
              <div>
                <div className="font-medium">requireTower=true</div>
                <p className="text-xs text-muted-foreground">
                  Target will refuse to activate without a tower bound to the transferred identity. The hosted sandbox uses the same production default.
                </p>
              </div>
            </div>
            <div className="md:col-span-2 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {fromId === toId ? "Source and target must differ." : "Direction looks good."}
              </div>
              <Button disabled={fromId === toId} onClick={() => setStep("preflight")}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "preflight" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 2 · preflight</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Quick recap. Full output is on the{" "}
              <Link href="/dashboard/preflight" className="underline">
                preflight page
              </Link>
              .
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {[fromId, toId].map((id) => (
                <div key={id} className="rounded-md border border-border/60 p-3">
                  <div className="mb-2 text-sm font-medium">{peers.find((p) => p.id === id)?.label}</div>
                  <ul className="space-y-1 text-xs">
                    {checksFor(id).map((c) => (
                      <li key={c.name} className="flex items-center gap-2">
                        {c.status === "ok" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : c.status === "warn" ? (
                          <ShieldAlert className="h-3.5 w-3.5 text-warning" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                        )}
                        <span className="font-mono">{c.name}</span>
                        <span className="text-muted-foreground">— {c.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {preflightFails > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {preflightFails} failing check(s). Resolve before continuing.
              </div>
            ) : null}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("direction")}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep("plan")} disabled={preflightFails > 0}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "plan" && fromPeer && toPeer ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 3 · plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <PlanDiff
              before={{
                source: { nodeLabel: fromPeer.label, identity: fromNode?.identityPubkey ?? "", role: "voting" },
                target: { nodeLabel: toPeer.label, identity: toNode?.identityPubkey ?? "", role: "standby" },
              }}
              after={{
                source: { nodeLabel: fromPeer.label, identity: toNode?.identityPubkey ?? "", role: "standby" },
                target: { nodeLabel: toPeer.label, identity: fromNode?.identityPubkey ?? "", role: "voting (after)" },
              }}
            />
            <Separator />
            <div className="grid gap-4 md:grid-cols-2">
              <SwapTimeline preview />
              <div className="text-sm space-y-2">
                <div className="font-medium">Expected window</div>
                <p className="text-muted-foreground">
                  1–3 seconds total. The source pauses voting at <code className="font-mono">stop-voting</code>;
                  the target resumes at <code className="font-mono">activate</code>.
                </p>
                <div className="font-medium pt-2">requireTower</div>
                <p className="text-muted-foreground">
                  Enabled. Production agents reject swaps that attempt to disable tower validation.
                </p>
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("preflight")}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => startExecute({ dryRun: true })}>
                  Dry-run
                </Button>
                <Button onClick={() => setStep("confirm")}>Continue to confirm</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "confirm" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Step 4 · confirm</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-warning">
                <AlertTriangle className="h-4 w-4" /> This will pause source voting
              </div>
              <p className="mt-1 text-warning/90">
                Source stops voting at the start of the swap and only resumes (on the new host) once activation succeeds.
                Expected total downtime: 1–3 seconds.
              </p>
            </div>
            <ConfirmWithWord word="SWAP" onChange={setConfirmed} />
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("plan")}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => startExecute({ dryRun: false })} disabled={!confirmed}>
                <PlayCircle className="h-4 w-4" /> Execute swap
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "execute" ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              Step 5 · executing
              {runMode === "dry-run" ? <Badge tone="warning">dry-run</Badge> : null}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={abortRun}>
              <ArrowLeft className="h-4 w-4" /> {runMode === "dry-run" ? "Cancel dry-run" : "Abort"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
              <SwapTimeline
                steps={ALL_PHASES.map((phase) => ({ phase, state: stepStates[phase] }))}
              />
              <ProgressStream events={progress} />
            </div>
            <p className="text-xs text-muted-foreground">
              {runMode === "dry-run"
                ? "Dry-run replays the swap timeline without touching the validators. No tower files move, no setIdentity calls."
                : "Don’t close this tab. If you do, recover with "}
              {runMode === "dry-run" ? null : <code className="font-mono">vswap status</code>}
              {runMode === "dry-run" ? null : "."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {step === "result" && result ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {result.outcome === "completed" ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-success" />{" "}
                  {result.runMode === "dry-run" ? "Dry-run completed" : "Swap completed"}
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-destructive" /> Swap failed
                </>
              )}
              {result.runMode === "dry-run" ? <Badge tone="warning">no side effects</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Stat label="Total window" value={formatDuration(result.totalMs)} />
              <Stat
                label="Final identity"
                value={<PubkeyBadge pubkey={result.finalIdentity} />}
              />
              <Stat label="Source last voted slot" value={String(result.events[1]?.slot ?? "—")} mono />
              <Stat label="Target first voted slot" value={String(result.events[result.events.length - 1]?.slot ?? "—")} mono />
            </div>

            <div>
              <Label>Per-step duration</Label>
              <ul className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-2">
                {ALL_PHASES.map((phase) => (
                  <li key={phase} className="flex justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-1.5">
                    <span>{PHASE_LABEL[phase]}</span>
                    <span className="text-muted-foreground">
                      {result.stepDurations[phase] !== undefined
                        ? `${result.stepDurations[phase]!}ms`
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              {auditUrl ? (
                <a
                  href={auditUrl}
                  download={`vswap-audit-${result.runMode}.json`}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
                >
                  <Download className="h-4 w-4" /> Download audit log
                </a>
              ) : null}
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={reset}>
                  <Repeat className="h-4 w-4" /> Run another swap
                </Button>
                <Link href="/dashboard">
                  <Button variant="ghost">Back to overview</Button>
                </Link>
              </div>
            </div>

            {result.outcome !== "completed" ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <div className="flex items-center gap-2 font-medium">
                  <RotateCcw className="h-4 w-4" /> Next steps
                </div>
                <ul className="mt-1 list-disc pl-5">
                  <li>Inspect the progress stream above for the failing phase.</li>
                  <li>
                    If the source is paused, issue rollback from{" "}
                    <Link href="/dashboard" className="underline">
                      overview
                    </Link>
                    .
                  </li>
                  <li>Re-run preflight before retrying.</li>
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
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
      <div className={`mt-1 text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
      {STEPS.map((s, i) => (
        <li
          key={s.id}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${
            i < idx
              ? "border-success/40 bg-success/10 text-success"
              : i === idx
                ? "border-foreground bg-foreground text-background"
                : "border-border"
          }`}
        >
          <span>{i + 1}</span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={label}>{label}</Label>
      <select
        id={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-background">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function initialStepStates(): Record<SwapPhase, StepState> {
  return {
    precheck: "upcoming",
    "stop-voting": "upcoming",
    "ship-tower": "upcoming",
    activate: "upcoming",
    cleanup: "upcoming",
    health: "upcoming",
  };
}

interface ReplayOpts {
  onEvent(ev: SwapProgress, idx: number): void;
  onDone(events: SwapProgress[]): void;
}

function replayEvents(events: SwapProgress[], opts: ReplayOpts): () => void {
  const emitted: SwapProgress[] = [];
  let i = 0;
  let timer: number | null = null;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    if (i >= events.length) {
      opts.onDone(emitted);
      return;
    }
    const ev = events[i]!;
    ev.ts = Date.now();
    emitted.push(ev);
    opts.onEvent(ev, i);
    i += 1;
    timer = window.setTimeout(tick, 320);
  };
  tick();
  return () => {
    cancelled = true;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
}



