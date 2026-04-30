import { describe, expect, it } from "vitest";
import {
  DecryptionFailedError,
  ErrorCode,
  MessageSchemaError,
  PayloadTooLargeError,
  ProtocolError,
  PubkeyMismatchError,
  ReplayDetectedError,
  SignatureInvalidError,
  TowerInvalidError,
  VersionMismatchError,
  serialiseError,
} from "../src/errors.js";

describe("error classes", () => {
  const cases: ReadonlyArray<{
    Cls: new () => ProtocolError;
    code: string;
    name: string;
  }> = [
    { Cls: SignatureInvalidError, code: ErrorCode.SignatureInvalid, name: "SignatureInvalidError" },
    { Cls: MessageSchemaError, code: ErrorCode.MessageSchema, name: "MessageSchemaError" },
    { Cls: ReplayDetectedError, code: ErrorCode.ReplayDetected, name: "ReplayDetectedError" },
    { Cls: DecryptionFailedError, code: ErrorCode.DecryptionFailed, name: "DecryptionFailedError" },
    { Cls: PubkeyMismatchError, code: ErrorCode.PubkeyMismatch, name: "PubkeyMismatchError" },
    { Cls: TowerInvalidError, code: ErrorCode.TowerInvalid, name: "TowerInvalidError" },
    { Cls: VersionMismatchError, code: ErrorCode.VersionMismatch, name: "VersionMismatchError" },
    { Cls: PayloadTooLargeError, code: ErrorCode.PayloadTooLarge, name: "PayloadTooLargeError" },
  ];

  for (const { Cls, code, name } of cases) {
    it(`${name} carries code ${code} with default message+context`, () => {
      const err = new Cls();
      expect(err).toBeInstanceOf(ProtocolError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.name).toBe(name);
      expect(err.message.length).toBeGreaterThan(0);
      expect(err.context).toEqual({});
    });
  }

  it("ProtocolError accepts a custom message and context", () => {
    const err = new ProtocolError(ErrorCode.Protocol, "custom", {
      pubkeySize: 32,
    });
    expect(err.message).toBe("custom");
    expect(err.context).toEqual({ pubkeySize: 32 });
  });

  it("error subclasses accept a custom message and context", () => {
    const err = new PayloadTooLargeError("too big", { size: 5 });
    expect(err.message).toBe("too big");
    expect(err.context).toEqual({ size: 5 });
  });

  it("serialiseError produces the expected shape", () => {
    const err = new DecryptionFailedError("nope", { ciphertextSize: 10 });
    expect(serialiseError(err)).toEqual({
      code: ErrorCode.DecryptionFailed,
      message: "nope",
      context: { ciphertextSize: 10 },
    });
  });
});
