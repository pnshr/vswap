"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, GitBranch, History, Network, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOperator } from "@/lib/operator-context";
import { Badge } from "@/components/ui/badge";

const NAV: Array<{ href: string; label: string; icon: React.ReactNode }> = [
  { href: "/dashboard", label: "Overview", icon: <Activity className="h-4 w-4" /> },
  { href: "/dashboard/preflight", label: "Preflight", icon: <ShieldCheck className="h-4 w-4" /> },
  { href: "/dashboard/swap", label: "Swap", icon: <GitBranch className="h-4 w-4" /> },
  { href: "/dashboard/history", label: "History", icon: <History className="h-4 w-4" /> },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { mode, config, ready } = useOperator();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-foreground/40 bg-foreground/5">
                <Network className="h-3.5 w-3.5" />
              </span>
              <span>vswap</span>
              <span className="text-muted-foreground">/dashboard</span>
            </Link>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 text-xs">
            {ready ? (
              mode === "demo" ? (
                <Badge tone="warning">sandbox</Badge>
              ) : mode === "locked" ? (
                <Badge tone="muted">locked</Badge>
              ) : (
                <Badge tone="success">live</Badge>
              )
            ) : null}
            {config ? (
              <span className="hidden sm:block font-mono text-[11px] text-muted-foreground">
                {config.name}
              </span>
            ) : (
              <Link
                href="/connect"
                className="inline-flex h-8 items-center rounded-md border border-border px-3 font-medium hover:bg-muted"
              >
                Connect
              </Link>
            )}
          </div>
        </div>
        <MobileNav pathname={pathname} />
      </header>
      <main className="container py-6">{children}</main>
      <footer className="border-t border-border/60">
        <div className="container flex h-12 items-center justify-between text-[11px] text-muted-foreground">
          <span>vswap · validator identity sandbox</span>
          <div className="flex items-center gap-3 font-mono">
            <a
              className="hover:text-foreground"
              href="https://github.com/pnshr/vswap"
              target="_blank"
              rel="noreferrer"
            >
              github
            </a>
            <span>·</span>
            <Link href="/" className="hover:text-foreground">
              about
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-t border-border/60 px-2 py-1.5 md:hidden">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs",
              active ? "bg-muted text-foreground" : "text-muted-foreground",
            )}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
