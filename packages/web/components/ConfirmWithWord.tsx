"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  word: string;
  onChange(matches: boolean): void;
  /** Optional hint text shown above the input. */
  hint?: string;
}

export function ConfirmWithWord({ word, onChange, hint }: Props) {
  const [value, setValue] = useState("");

  function update(next: string) {
    const upper = next.toUpperCase();
    setValue(upper);
    onChange(upper === word.toUpperCase());
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="confirm-word">
        Type <span className="font-mono uppercase text-foreground">{word}</span> to confirm
      </Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Input
        id="confirm-word"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={value}
        onChange={(e) => update(e.target.value)}
        placeholder={word}
        className="font-mono uppercase"
      />
    </div>
  );
}
