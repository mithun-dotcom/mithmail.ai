import { describe, expect, it } from "vitest";
import type { LeadEsp } from "@prisma/client";
import { assignLeads, espMatches } from "./scheduler";

const lead = (id: string, esp: LeadEsp) => ({ id, lead: { esp } });
const acct = (id: string, provider: "GOOGLE" | "MICROSOFT" | "SMTP") => ({ id, provider });

describe("espMatches", () => {
  it("matches same provider only", () => {
    expect(espMatches({ provider: "GOOGLE" }, "GOOGLE")).toBe(true);
    expect(espMatches({ provider: "SMTP" }, "OTHER")).toBe(false);
  });
});

describe("assignLeads", () => {
  it("gives each inbox at most one lead", () => {
    const res = assignLeads([lead("1", "OTHER"), lead("2", "OTHER"), lead("3", "OTHER")], [acct("a", "SMTP"), acct("b", "SMTP")], false);
    expect(res.map((r) => r.account.id).sort()).toEqual(["a", "b"]);
  });
  it("pairs providers when ESP matching is on", () => {
    const res = assignLeads([lead("g", "GOOGLE"), lead("m", "MICROSOFT")], [acct("ms", "MICROSOFT"), acct("gg", "GOOGLE")], true);
    const byLead = Object.fromEntries(res.map((r) => [r.lead.id, r.account.id]));
    expect(byLead).toEqual({ g: "gg", m: "ms" });
  });
  it("falls back to any inbox when no match exists", () => {
    const res = assignLeads([lead("g", "GOOGLE")], [acct("x", "SMTP")], true);
    expect(res[0].account.id).toBe("x");
  });
  it("prefers matched leads so mismatches don't steal matching inboxes", () => {
    const res = assignLeads([lead("o", "OTHER"), lead("g", "GOOGLE")], [acct("gg", "GOOGLE"), acct("s", "SMTP")], true);
    const byLead = Object.fromEntries(res.map((r) => [r.lead.id, r.account.id]));
    expect(byLead).toEqual({ g: "gg", o: "s" });
  });
  it("round-robins across all free inboxes without matching", () => {
    const leads = Array.from({ length: 10 }, (_, i) => lead(String(i), "UNKNOWN"));
    const res = assignLeads(leads, [acct("a", "SMTP"), acct("b", "SMTP"), acct("c", "SMTP")], false);
    expect(res).toHaveLength(3);
    expect(new Set(res.map((r) => r.account.id)).size).toBe(3);
  });
});
