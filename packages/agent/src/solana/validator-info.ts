import type { AdminRpcClient, ContactInfo } from "./admin-rpc.js";
import { ValidatorUnreachableError } from "../errors.js";

export interface ValidatorInfo {
  readonly contactInfo: ContactInfo;
  readonly rpcAddress: string | null;
}

/**
 * Combined snapshot of validator state as far as the admin RPC socket
 * can reveal. Either call can legitimately fail in isolation
 * (`rpcAddress` is optional for RPC-less validators) — so we log the
 * sub-failures on the caller side rather than hard-failing here.
 */
export async function gatherValidatorInfo(
  rpc: AdminRpcClient,
): Promise<ValidatorInfo> {
  let contactInfo: ContactInfo;
  try {
    contactInfo = await rpc.contactInfo();
  } catch (err) {
    throw new ValidatorUnreachableError(
      "could not fetch contactInfo from admin RPC socket",
      { cause: err instanceof Error ? err.message : String(err) },
    );
  }
  let rpcAddress: string | null = null;
  try {
    rpcAddress = await rpc.rpcAddress();
  } catch {
    rpcAddress = null;
  }
  return { contactInfo, rpcAddress };
}
