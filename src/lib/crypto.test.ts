import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "./crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("crypto", () => {
  it("round-trips", () => {
    const ct = encrypt("s3cret-päss");
    expect(ct).not.toContain("s3cret");
    expect(decrypt(ct)).toBe("s3cret-päss");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });

  it("rejects tampered ciphertext", () => {
    const parts = encrypt("hello").split(":");
    parts[3] = Buffer.from("jello").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});
