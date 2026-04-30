import { CircuitBoard, Clock, Server, Signal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PubkeyBadge } from "@/components/PubkeyBadge";
import { formatRelative } from "@/lib/utils";
import type { NodeStatus } from "@/lib/types";

interface Props {
  node: NodeStatus;
  /** Mark this node as the currently-staked / primary one. */
  primary?: boolean;
}

export function NodeStatusCard({ node, primary }: Props) {
  return (
    <Card className="relative overflow-hidden">
      {primary ? (
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-success to-transparent" />
      ) : null}
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md border border-border bg-muted/40 p-2 text-foreground">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold leading-tight">{node.label}</h3>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {node.host}:{node.port}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {primary ? <Badge tone="success">staked</Badge> : <Badge tone="muted">standby</Badge>}
          {node.delinquent ? (
            <Badge tone="destructive">delinquent</Badge>
          ) : node.reachable ? (
            <Badge tone="outline">healthy</Badge>
          ) : (
            <Badge tone="warning">unreachable</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row label="Validator" value={node.version} mono />
        <Row
          label="Identity"
          value={<PubkeyBadge pubkey={node.identityPubkey} />}
        />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Stat icon={<Signal className="h-3.5 w-3.5" />} label="Caught up">
            <span className="font-mono">{node.caughtUpSlot.toLocaleString()}</span>
            <span className="ml-1 text-xs text-muted-foreground">
              (lag {node.slotLag})
            </span>
          </Stat>
          <Stat icon={<Clock className="h-3.5 w-3.5" />} label="Last swap">
            {node.lastSwapAt ? (
              <span title={new Date(node.lastSwapAt).toISOString()}>
                {formatRelative(node.lastSwapAt)}
              </span>
            ) : (
              <span className="text-muted-foreground">never</span>
            )}
          </Stat>
        </div>
      </CardContent>
      <div className="pointer-events-none absolute -bottom-12 -right-12 opacity-[0.04]">
        <CircuitBoard className="h-44 w-44" />
      </div>
    </Card>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}

function Stat({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
