import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PubkeyBadge } from "@/components/PubkeyBadge";
import { Badge } from "@/components/ui/badge";

export interface PlanState {
  nodeLabel: string;
  identity: string;
  role: "voting" | "paused" | "standby" | "voting (after)";
}

interface Props {
  before: { source: PlanState; target: PlanState };
  after: { source: PlanState; target: PlanState };
}

export function PlanDiff({ before, after }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-stretch">
      <Side title="Before" state={before} />
      <div className="hidden md:flex items-center justify-center text-muted-foreground">
        <ArrowRight className="h-5 w-5" />
      </div>
      <Side title="After" state={after} />
    </div>
  );
}

function Side({
  title,
  state,
}: {
  title: string;
  state: { source: PlanState; target: PlanState };
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <Row state={state.source} />
        <Row state={state.target} />
      </CardContent>
    </Card>
  );
}

function Row({ state }: { state: PlanState }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div>
        <div className="text-sm font-medium">{state.nodeLabel}</div>
        <PubkeyBadge pubkey={state.identity} className="mt-1" />
      </div>
      <Badge tone={tone(state.role)}>{state.role}</Badge>
    </div>
  );
}

function tone(role: PlanState["role"]): "success" | "warning" | "muted" {
  if (role === "voting" || role === "voting (after)") return "success";
  if (role === "paused") return "warning";
  return "muted";
}
