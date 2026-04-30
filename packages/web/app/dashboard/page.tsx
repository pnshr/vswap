"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GitBranch, Info, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NodeStatusCard } from "@/components/NodeStatusCard";
import { useOperator } from "@/lib/operator-context";
import { DEMO_NODE_STATUS, buildLiveNodeStubs } from "@/lib/demo";
import type { NodeStatus } from "@/lib/types";
import { fetchStatus, parseOperatorSecret } from "@/lib/agent-client";

export default function DashboardOverview() {
  const { mode, config, unlockedSecret } = useOperator();
  const secret = useMemo(() => parseOperatorSecret(unlockedSecret), [unlockedSecret]);

  const baseNodes: NodeStatus[] = useMemo(
    () => (mode === "demo" || !config ? DEMO_NODE_STATUS : buildLiveNodeStubs(config.peers)),
    [config, mode],
  );
  const [nodes, setNodes] = useState<NodeStatus[]>(baseNodes);
  useEffect(() => {
    setNodes(baseNodes);
    const peers =
      mode === "demo" || !config
        ? DEMO_NODE_STATUS.map((node) => ({
            id: node.id,
            label: node.label,
            host: node.host,
            port: node.port,
            agentPubkey: node.identityPubkey,
            sandbox: true,
          }))
        : mode === "live" && secret !== null
          ? config.peers.map((peer) => ({ ...peer, secret }))
          : [];
    if (peers.length === 0) return;
    Promise.all(peers.map((peer) => fetchStatus(peer).then((response) => response.status)))
      .then(setNodes)
      .catch(() => setNodes(baseNodes));
  }, [baseNodes, config, mode, secret]);
  const stakedId = nodes.find((n) => !n.identityPubkey.startsWith("UnSt"))?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cluster overview</h1>
          <p className="text-sm text-muted-foreground">
            Paired validator nodes, current voting identity, catchup status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/preflight">
            <Button variant="outline">
              <ShieldCheck className="h-4 w-4" /> Run preflight
            </Button>
          </Link>
          <Link href="/dashboard/swap">
            <Button>
              <GitBranch className="h-4 w-4" /> Swap identity
            </Button>
          </Link>
        </div>
      </div>

      {mode === "demo" ? <SandboxBanner /> : null}
      {mode === "locked" ? <LockedBanner /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {nodes.map((n) => (
          <NodeStatusCard key={n.id} node={n} primary={n.id === stakedId} />
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <Badge tone="outline">5s</Badge>
          <span className="text-muted-foreground">
            Status polled every 5 seconds. Live progress for active swaps streams via WebSocket.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function SandboxBanner() {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5">
            <Info className="h-4 w-4 text-warning" />
          </span>
          <div>
            <div className="font-medium">Hosted sandbox</div>
            <p className="text-muted-foreground">
              No operator config imported. This public deployment talks to disposable sandbox validators so reviewers can run the full flow end-to-end.
              Use the CLI or a self-hosted dashboard for real validator agents.
            </p>
          </div>
        </div>
        <Link href="/connect">
          <Button size="sm" variant="outline">
            Import config <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function LockedBanner() {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5">
            <Info className="h-4 w-4 text-warning" />
          </span>
          <div>
            <div className="font-medium">Config locked</div>
            <p className="text-muted-foreground">
              Cert + signing key are encrypted at rest. Unlock with your passphrase to talk to agents.
            </p>
          </div>
        </div>
        <Link href="/connect">
          <Button size="sm">Unlock</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
