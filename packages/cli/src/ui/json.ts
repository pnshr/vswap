/**
 * `--json` mode renderers. Every command honours a global `--json`
 * flag; when set, output is one JSON object per logical "event" on a
 * single line so it can be piped through `jq` or fed to a structured
 * log collector.
 */

export interface JsonEnvelope<T> {
  readonly type: string;
  readonly timestamp: string;
  readonly payload: T;
}

export function jsonLine<T>(type: string, payload: T): JsonEnvelope<T> {
  return {
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function emitJson<T>(
  type: string,
  payload: T,
  stream: NodeJS.WriteStream = process.stdout,
): void {
  stream.write(`${JSON.stringify(jsonLine(type, payload))}\n`);
}
