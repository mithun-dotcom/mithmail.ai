import { describe, expect, it } from "vitest";
import type { Lead } from "@prisma/client";
import { renderLeadFields, sendingHours } from "./service";
import { extractList, normalizeSender } from "./client";

const lead = {
  id: "lead-1",
  email: "ana@acme.com",
  firstName: "Ana",
  lastName: null,
  companyName: "Acme",
  linkedinUrl: null,
  customVariables: { "Job Title": "CTO", icebreaker: "Loved the Acme launch" },
} as unknown as Lead;
const campaign = { scheduleTimezone: "UTC", sendAsPlainText: false };
const steps = [
  { id: "s1", stepNumber: 1, subject: "{Quick question|Idea} for {{company_name}}", bodySpintax: "{Hi|Hey} {{first_name|there}},\n\n{{icebreaker}}. As {{Job Title}}…", bodyHtml: null, abTestVariants: null },
  { id: "s2", stepNumber: 2, subject: "", bodySpintax: "Bumping this, {{last_name|friend}}.", bodyHtml: null, abTestVariants: null },
];

describe("renderLeadFields", () => {
  const f = renderLeadFields(campaign, steps, lead, { emailAddress: "jo@send.io", fromName: "Jo", signature: null });

  it("renders spintax, variables and fallbacks per lead", () => {
    expect(f.mm_subject_1).toMatch(/^(Quick question|Idea) for Acme$/);
    expect(f.mm_body_1).toMatch(/^<p>(Hi|Hey) Ana,<\/p><p>Loved the Acme launch\. As CTO…<\/p>$/);
    expect(f.mm_body_2).toBe("<p>Bumping this, friend.</p>");
    for (const v of Object.values(f)) expect(v).not.toMatch(/[{}|]/); // no leftover spintax or tags
  });
  it("threads blank follow-up subjects", () => {
    expect(f.mm_subject_2).toBe(`Re: ${f.mm_subject_1}`);
  });
  it("uses snake_case standard fields", () => {
    expect(f).toMatchObject({ email: "ana@acme.com", first_name: "Ana", last_name: "", company_name: "Acme" });
    for (const k of Object.keys(f)) expect(k).toMatch(/^[a-z0-9_]+$/);
  });
  it("is deterministic per lead", () => {
    expect(renderLeadFields(campaign, steps, lead, null).mm_subject_1).toBe(f.mm_subject_1);
  });
  it("picks A/B variants per lead", () => {
    const ab = [{ ...steps[0], abTestVariants: [{ id: "B", subject: "Variant B", body: "B body", weight: 50 }] }];
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(renderLeadFields(campaign, ab, { ...lead, id: `l${i}` } as Lead, null).mm_subject_1.startsWith("Variant B") ? "B" : "A");
    expect([...seen].sort()).toEqual(["A", "B"]);
  });
});

describe("sendingHours", () => {
  it("lists every day Monday..Sunday", () => {
    const h = sendingHours([1, 2, 3, 4, 5], "09:00", "17:00");
    expect(h.map((d) => d.name)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(h.filter((d) => d.enabled).length).toBe(5);
    expect(h[0]).toEqual({ name: "Monday", enabled: true, fromTime: "09:00", toTime: "17:00" });
  });
});

describe("normalizeSender", () => {
  it("accepts common field names", () => {
    expect(normalizeSender({ _id: "x1", from_email: "A@B.com", from_name: "A" })).toMatchObject({ id: "x1", email: "a@b.com", name: "A" });
    expect(normalizeSender({ id: "x2", email: "c@d.io" })).toMatchObject({ id: "x2", email: "c@d.io" });
  });
  it("rejects objects without id or email", () => {
    expect(normalizeSender({ email: "a@b.com" })).toBeNull();
    expect(normalizeSender({ id: "1", email: "nope" })).toBeNull();
  });
});

describe("tolerant sender parsing", () => {
  it("finds the list in different envelopes", () => {
    const item = { sender_id: "s1", email: "a@b.io" };
    expect(extractList({ success: true, data: [item] })).toEqual([item]);
    expect(extractList({ data: { senders: [item] } })).toEqual([item]);
    expect(extractList([item])).toEqual([item]);
    expect(extractList({ success: true })).toEqual([]);
  });
  it("reads ids from sender_id / numbers and emails from nested fields", () => {
    expect(normalizeSender({ sender_id: "4b58f0b7", email: "sam@montagemotionhub.co" })).toMatchObject({ id: "4b58f0b7", email: "sam@montagemotionhub.co" });
    expect(normalizeSender({ _id: 42, smtp: { user: "X@Y.io" } })).toMatchObject({ id: "42", email: "x@y.io" });
    expect(normalizeSender({ id: "1", label: "Main", owner: "notanemail" })).toBeNull();
  });
});
