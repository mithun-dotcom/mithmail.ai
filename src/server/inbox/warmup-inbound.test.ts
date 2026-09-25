import { describe, expect, it } from "vitest";
import { parseWarmupHeader } from "./warmup-inbound";
import { stripQuoted } from "./reply-processor";

describe("parseWarmupHeader", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it("parses originals and replies", () => {
    expect(parseWarmupHeader(id)).toEqual({ logId: id, isReply: false });
    expect(parseWarmupHeader(`${id}:r`)).toEqual({ logId: id, isReply: true });
  });
  it("rejects junk", () => {
    expect(parseWarmupHeader("nope")).toBeNull();
    expect(parseWarmupHeader(undefined)).toBeNull();
  });
});

describe("stripQuoted", () => {
  it("drops quoted history", () => {
    expect(stripQuoted("Yes please!\n\nOn Mon, Jo wrote:\n> hi")).toBe("Yes please!");
    expect(stripQuoted("Sure\n> quoted\nthanks")).toBe("Sure\nthanks");
  });
});
