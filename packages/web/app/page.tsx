import Link from "next/link";
import { ArrowRight, GitBranch, Lock, Network, Shield, ShieldCheck, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Landing() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-foreground/40 bg-foreground/5">
              <Network className="h-3.5 w-3.5" />
            </span>
            vswap
          </Link>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <a className="hover:text-foreground" href="https://github.com/pnshr/vswap" target="_blank" rel="noreferrer">
              github
            </a>
            <Link href="/connect" className="hover:text-foreground">
              connect
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-8 items-center rounded-md bg-foreground px-3 text-[11px] font-semibold uppercase tracking-wider text-background"
            >
              Open dashboard
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 grid-bg opacity-50" aria-hidden />
        <div className="container relative grid gap-10 py-16 md:grid-cols-[1.2fr_1fr] md:gap-16 md:py-24">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              operator dashboard
            </div>
            <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
              Hot-swap a Solana validator identity
              <span className="block text-muted-foreground">
                without exposing the key.
              </span>
            </h1>
            <p className="max-w-xl text-base text-muted-foreground md:text-lg">
              vswap moves a running validator&apos;s voting identity from host A to host B with a
              targeted 1–3 second downtime window. The identity key is only ever in plaintext
              inside the agent that owns it; every wire hop is signed and sealed.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/dashboard">
                <Button size="lg" className="gap-2">
                  Open dashboard
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/connect">
                <Button size="lg" variant="outline">
                  Import operator config
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 font-mono text-[11px] text-muted-foreground">
              <span>mTLS-only transport</span>
              <span>·</span>
              <span>Ed25519-signed envelopes</span>
              <span>·</span>
              <span>X25519 sealed-box identity blob</span>
              <span>·</span>
              <span>tower-aware activation</span>
            </div>
          </div>

          <ArchitectureDiagram />
        </div>
      </section>

      <section className="container py-16">
        <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
          What the dashboard does
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Feature
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Preflight"
            body="Validator reachability, catchup, tower presence, identity symlink, authorized-voter — all checks run on both nodes before you commit to a swap."
          />
          <Feature
            icon={<GitBranch className="h-4 w-4" />}
            title="Guided swap"
            body="Direction, plan diff, dry-run, word confirmation, live progress stream. Every step is reversible until activation; rollback is one click."
          />
          <Feature
            icon={<Lock className="h-4 w-4" />}
            title="Operator stays sovereign"
            body="Your client cert and signing key are decrypted in-browser with a passphrase you choose, kept in memory only, never written to the dashboard server."
          />
        </div>
      </section>

      <section className="border-t border-border/60">
        <div className="container py-16">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
            Security model
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="space-y-2 p-5 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Shield className="h-4 w-4" /> Identity key never transits in plaintext
                </div>
                <p className="text-muted-foreground">
                  Agent-A reads the identity, seals it against Agent-B&apos;s ephemeral X25519 session
                  pubkey, then scrubs the buffer. Only Agent-B can decrypt; the relay sees ciphertext only.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2 p-5 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Terminal className="h-4 w-4" /> Web is a thin client
                </div>
                <p className="text-muted-foreground">
                  This dashboard is a proxy + UI. It never holds long-term secret material on the
                  server. mTLS to agents is established per-request and torn down with the request.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="container flex h-14 items-center justify-between text-[11px] text-muted-foreground">
          <span>vswap · Solana validator identity hot-swap</span>
          <div className="flex items-center gap-3 font-mono">
            <a className="hover:text-foreground" href="https://github.com/pnshr/vswap" target="_blank" rel="noreferrer">
              github
            </a>
            <span>·</span>
            <Link href="/dashboard" className="hover:text-foreground">
              dashboard
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-5 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-muted/40">
            {icon}
          </span>
          {title}
        </div>
        <p className="text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

function ArchitectureDiagram() {
  // Inline SVG instead of mermaid so we can control style precisely and
  // avoid runtime cost.
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <svg
          viewBox="0 0 480 320"
          className="h-auto w-full"
          aria-label="vswap architecture: operator on the left, agent-A and agent-B in the middle, validator processes on the right"
          role="img"
        >
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 6 L6 0" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="480" height="320" fill="url(#hatch)" className="text-foreground" />
          {/* Operator */}
          <g>
            <rect x="20" y="120" width="100" height="80" rx="8" className="fill-muted stroke-border" strokeWidth="1" />
            <text x="70" y="155" textAnchor="middle" className="fill-foreground" fontSize="12" fontFamily="ui-monospace, monospace">operator</text>
            <text x="70" y="175" textAnchor="middle" className="fill-muted-foreground" fontSize="10" fontFamily="ui-monospace, monospace">CLI / web</text>
          </g>
          {/* Agent A */}
          <g>
            <rect x="180" y="40" width="120" height="100" rx="8" className="fill-card stroke-border" strokeWidth="1" />
            <text x="240" y="72" textAnchor="middle" className="fill-foreground" fontSize="12" fontFamily="ui-monospace, monospace">agent-A</text>
            <text x="240" y="92" textAnchor="middle" className="fill-muted-foreground" fontSize="10" fontFamily="ui-monospace, monospace">source</text>
            <text x="240" y="112" textAnchor="middle" className="fill-muted-foreground" fontSize="10" fontFamily="ui-monospace, monospace">reads + seals</text>
            <text x="240" y="128" textAnchor="middle" className="fill-success" fontSize="9" fontFamily="ui-monospace, monospace">staked</text>
          </g>
          {/* Agent B */}
          <g>
            <rect x="180" y="180" width="120" height="100" rx="8" className="fill-card stroke-border" strokeWidth="1" />
            <text x="240" y="212" textAnchor="middle" className="fill-foreground" fontSize="12" fontFamily="ui-monospace, monospace">agent-B</text>
            <text x="240" y="232" textAnchor="middle" className="fill-muted-foreground" fontSize="10" fontFamily="ui-monospace, monospace">target</text>
            <text x="240" y="252" textAnchor="middle" className="fill-muted-foreground" fontSize="10" fontFamily="ui-monospace, monospace">decrypts in-tmpfs</text>
            <text x="240" y="268" textAnchor="middle" className="fill-warning" fontSize="9" fontFamily="ui-monospace, monospace">standby → staked</text>
          </g>
          {/* Validators */}
          <g>
            <rect x="360" y="60" width="100" height="60" rx="8" className="fill-muted/50 stroke-border" strokeWidth="1" />
            <text x="410" y="85" textAnchor="middle" className="fill-foreground" fontSize="11" fontFamily="ui-monospace, monospace">validator</text>
            <text x="410" y="100" textAnchor="middle" className="fill-muted-foreground" fontSize="9" fontFamily="ui-monospace, monospace">admin RPC</text>
            <rect x="360" y="200" width="100" height="60" rx="8" className="fill-muted/50 stroke-border" strokeWidth="1" />
            <text x="410" y="225" textAnchor="middle" className="fill-foreground" fontSize="11" fontFamily="ui-monospace, monospace">validator</text>
            <text x="410" y="240" textAnchor="middle" className="fill-muted-foreground" fontSize="9" fontFamily="ui-monospace, monospace">admin RPC</text>
          </g>
          {/* Lines */}
          <g stroke="currentColor" strokeOpacity="0.45" fill="none" strokeWidth="1.2" className="text-foreground">
            <line x1="120" y1="150" x2="180" y2="90" />
            <line x1="120" y1="170" x2="180" y2="230" />
            <line x1="240" y1="140" x2="240" y2="180" strokeDasharray="3 3" />
            <line x1="300" y1="90" x2="360" y2="90" />
            <line x1="300" y1="230" x2="360" y2="230" />
          </g>
          <text x="252" y="162" className="fill-muted-foreground" fontSize="9" fontFamily="ui-monospace, monospace">sealed-box</text>
        </svg>
      </CardContent>
    </Card>
  );
}
