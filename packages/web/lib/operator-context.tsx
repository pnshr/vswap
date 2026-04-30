"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearMeta,
  clearSecret,
  loadMeta,
  loadSecret,
  saveMeta,
  saveSecret,
} from "./storage";
import { decryptSecret, encryptSecret } from "./crypto";
import type { OperatorConfigMetadata } from "./types";

export type ConnectionMode = "demo" | "live" | "locked";

interface OperatorState {
  /** Imported config metadata (peers, label, operator pubkey). */
  config: OperatorConfigMetadata | null;
  /** Whether an encrypted secret bundle exists in IndexedDB. */
  hasSecret: boolean;
  /** Decrypted secret JSON (cert + signing key) — in-memory only. */
  unlockedSecret: string | null;
  mode: ConnectionMode;
  ready: boolean;
}

interface OperatorContextValue extends OperatorState {
  importConfig(args: {
    metadata: OperatorConfigMetadata;
    secretJson: string;
    passphrase: string;
  }): Promise<void>;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  forget(): Promise<void>;
}

const OperatorContext = createContext<OperatorContextValue | null>(null);

export function OperatorProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<OperatorConfigMetadata | null>(null);
  const [hasSecret, setHasSecret] = useState(false);
  const [unlockedSecret, setUnlockedSecret] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [meta, secret] = await Promise.all([loadMeta(), loadSecret()]);
      setConfig(meta);
      setHasSecret(secret !== null);
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  const importConfig = useCallback(
    async (args: {
      metadata: OperatorConfigMetadata;
      secretJson: string;
      passphrase: string;
    }) => {
      const rec = await encryptSecret(args.passphrase, args.secretJson);
      await saveMeta(args.metadata);
      await saveSecret(rec);
      setConfig(args.metadata);
      setHasSecret(true);
      setUnlockedSecret(args.secretJson);
    },
    [],
  );

  const unlock = useCallback(async (passphrase: string) => {
    const rec = await loadSecret();
    if (!rec) return false;
    try {
      const plain = await decryptSecret(passphrase, rec);
      setUnlockedSecret(plain);
      return true;
    } catch {
      return false;
    }
  }, []);

  const lock = useCallback(() => {
    setUnlockedSecret(null);
  }, []);

  const forget = useCallback(async () => {
    await Promise.all([clearMeta(), clearSecret()]);
    setConfig(null);
    setHasSecret(false);
    setUnlockedSecret(null);
  }, []);

  const mode: ConnectionMode = useMemo(() => {
    if (!config) return "demo";
    if (!unlockedSecret) return "locked";
    return "live";
  }, [config, unlockedSecret]);

  const value = useMemo<OperatorContextValue>(
    () => ({
      config,
      hasSecret,
      unlockedSecret,
      mode,
      ready,
      importConfig,
      unlock,
      lock,
      forget,
    }),
    [config, hasSecret, unlockedSecret, mode, ready, importConfig, unlock, lock, forget],
  );

  return (
    <OperatorContext.Provider value={value}>
      {children}
    </OperatorContext.Provider>
  );
}

export function useOperator(): OperatorContextValue {
  const ctx = useContext(OperatorContext);
  if (!ctx) throw new Error("useOperator must be used inside OperatorProvider");
  return ctx;
}
