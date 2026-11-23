import { describe, expect, it } from "vitest";
import {
  assertSupportedChain,
  assertValidNonce,
  validateWalletSession,
} from "../../src/features/wallet/siwe";

describe("wallet siwe hardening", () => {
  it("accepts supported chain ids", () => {
    expect(() => assertSupportedChain(1)).not.toThrow();
  });

  it("rejects unsupported chain ids", () => {
    expect(() => assertSupportedChain(56)).toThrow("Unsupported chainId 56.");
  });

  it("validates nonce format", () => {
    expect(() =>
      assertValidNonce("nonce_with_adequate_len-1234"),
    ).not.toThrow();
    expect(() => assertValidNonce("short")).toThrow(
      "Invalid SIWE nonce format.",
    );
  });

  it("validates active wallet session", () => {
    expect(() =>
      validateWalletSession({
        address: "0x1111111111111111111111111111111111111111",
        chainId: 1,
        nonce: "nonce_with_adequate_len-1234",
        issuedAt: Date.now() - 1_000,
        expiresAt: Date.now() + 60_000,
      }),
    ).not.toThrow();
  });
});
