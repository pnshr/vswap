"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type DragEvent } from "react";
import { ArrowRight, FileLock2, KeyRound, ShieldAlert, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useOperator } from "@/lib/operator-context";
import type { OperatorConfigMetadata } from "@/lib/types";

interface RawExport {
  name?: string;
  operatorPubkey?: string;
  peers?: Array<{
    id?: string;
    label?: string;
    host?: string;
    port?: number;
    agentPubkey?: string;
  }>;
  /** Opaque secret material (PEMs, signing key). Validated structurally only. */
  secret?: Record<string, unknown>;
}

export default function ConnectPage() {
  const router = useRouter();
  const { config, hasSecret, mode, importConfig, unlock, lock, forget } = useOperator();
  const [parsed, setParsed] = useState<RawExport | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlockPassphrase, setUnlockPassphrase] = useState("");

  function loadFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        const obj = JSON.parse(text) as RawExport;
        if (!obj.peers || obj.peers.length === 0) {
          throw new Error("config has no peers");
        }
        if (!obj.operatorPubkey) {
          throw new Error("config is missing operatorPubkey");
        }
        if (!obj.secret) {
          throw new Error("config is missing secret bundle");
        }
        setParsed(obj);
        setFilename(file.name);
      } catch (e) {
        setParsed(null);
        setFilename(null);
        setError(e instanceof Error ? e.message : "invalid file");
      }
    };
    reader.onerror = () => setError("failed to read file");
    reader.readAsText(file);
  }

  function onSelect(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  }

  async function onImport() {
    if (!parsed) return;
    if (!passphrase) {
      setError("passphrase required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const metadata: OperatorConfigMetadata = {
        name: parsed.name ?? filename ?? "operator-config",
        importedAt: Date.now(),
        operatorPubkey: parsed.operatorPubkey ?? "",
        peers: (parsed.peers ?? []).map((p, idx) => ({
          id: p.id ?? `peer-${idx}`,
          label: p.label ?? p.id ?? `peer-${idx}`,
          host: p.host ?? "",
          port: p.port ?? 7872,
          agentPubkey: p.agentPubkey ?? "",
        })),
      };
      const secretJson = JSON.stringify(parsed.secret ?? {});
      await importConfig({ metadata, secretJson, passphrase });
      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onUnlock() {
    setBusy(true);
    setError(null);
    try {
      const ok = await unlock(unlockPassphrase);
      if (ok) {
        router.push("/dashboard");
      } else {
        setError("incorrect passphrase");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "unlock failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container max-w-4xl py-10">
      <div className="space-y-1">
        <Link href="/" className="text-xs font-mono text-muted-foreground hover:text-foreground">
          ← home
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Connect operator config</h1>
        <p className="text-sm text-muted-foreground">
          Import the JSON exported by the CLI: <code className="font-mono">vswap export --for-web &gt; vswap-export.json</code>.
          Only metadata is stored in plaintext. The cert and signing key are encrypted at rest with a passphrase you choose; when unlocked, a self-hosted live dashboard sends them only to its own API route for the current agent request.
        </p>
      </div>

      {config ? (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileLock2 className="h-4 w-4" /> {config.name}
              </CardTitle>
              <CardDescription>
                {config.peers.length} peer{config.peers.length === 1 ? "" : "s"} · imported{" "}
                {new Date(config.importedAt).toLocaleString()}
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {mode === "live" ? <Badge tone="success">unlocked</Badge> : <Badge tone="muted">locked</Badge>}
              {hasSecret ? <Badge tone="outline">secret bundle present</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1 text-sm">
              {config.peers.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div>
                    <div className="font-medium">{p.label}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {p.host}:{p.port}
                    </div>
                  </div>
                  <code className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                    {p.agentPubkey.slice(0, 8)}…{p.agentPubkey.slice(-4)}
                  </code>
                </li>
              ))}
            </ul>

            {mode !== "live" ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-4">
                <Label htmlFor="unlock">Unlock passphrase</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="unlock"
                    type="password"
                    autoComplete="off"
                    value={unlockPassphrase}
                    onChange={(e) => setUnlockPassphrase(e.target.value)}
                    className="max-w-sm"
                    placeholder="passphrase"
                  />
                  <Button onClick={onUnlock} disabled={busy || !unlockPassphrase}>
                    <KeyRound className="h-4 w-4" /> Unlock
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Decrypts the cert + signing key into React memory for this tab only. Closing the tab re-locks.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-md border border-success/30 bg-success/10 p-3 text-sm">
                <span>This tab is unlocked.</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={lock}>
                    Lock
                  </Button>
                  <Link href="/dashboard">
                    <Button size="sm">
                      Open dashboard <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Replace this config or remove it from this browser:
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  void forget();
                }}
              >
                <Trash2 className="h-4 w-4" /> Forget config
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import a new config
          </CardTitle>
          <CardDescription>
            Drop the <code className="font-mono">vswap-export.json</code> file or click to browse.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/20 p-10 text-center"
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <div className="text-sm">
              {filename ? (
                <span className="font-mono text-foreground">{filename}</span>
              ) : (
                <span className="text-muted-foreground">Drop vswap-export.json here, or</span>
              )}
            </div>
            <label className="cursor-pointer text-sm">
              <span className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted">browse files</span>
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={onSelect}
              />
            </label>
          </div>

          {parsed ? (
            <div className="rounded-md border border-border bg-muted/20 p-4 text-sm">
              <div className="font-medium">{parsed.name ?? "(unnamed)"}</div>
              <div className="text-xs text-muted-foreground">
                {parsed.peers?.length ?? 0} peer(s) · operator pubkey{" "}
                <code className="font-mono">{parsed.operatorPubkey}</code>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="passphrase">Passphrase</Label>
            <Input
              id="passphrase"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="choose a strong passphrase"
              className="max-w-sm"
            />
            <p className="text-xs text-muted-foreground">
              Used to derive an AES-GCM key (PBKDF2-HMAC-SHA256, 600 000 iterations). The passphrase
              is never sent to any server.
            </p>
          </div>

          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" /> {error}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button disabled={!parsed || busy} onClick={onImport}>
              {busy ? "Importing…" : "Encrypt & store"}
            </Button>
            <Link href="/dashboard">
              <Button variant="ghost">Skip — open sandbox dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
