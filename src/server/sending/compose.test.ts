import { beforeAll, describe, expect, it } from "vitest";
import type { Campaign, CampaignStep, EmailAccount, Lead } from "@prisma/client";
import { composeEmail, pickVariant } from "./compose";

beforeAll(() => {
  process.env.AUTH_SECRET = "s";
  process.env.APP_URL = "https://app.test";
});

const campaign = {
  id: "c1c1c1c1-0000",
  scheduleTimezone: "UTC",
  trackOpens: true,
  trackClicks: true,
  includeUnsubscribe: true,
  sendAsPlainText: false,
} as Campaign;
const lead = { id: "lead-1", email: "ana@acme.com", firstName: "Ana", lastName: null, companyName: "Acme", linkedinUrl: null, customVariables: { "Job Title": "CTO" } } as unknown as Lead;
const account = { emailAddress: "jo@send.io", fromName: "Jo", signature: "Jo\nSend.io", trackingDomain: null } as unknown as EmailAccount & { trackingDomain: null };
const step = (p: Partial<CampaignStep>) => ({ id: "s1", subject: "{Hi|Hey} {{first_name}}", bodySpintax: "Hello {{first_name}} ({{job_title}}) https://acme.com/x", abTestVariants: null, ...p }) as CampaignStep;

describe("composeEmail", () => {
  it("renders, tracks and signs", () => {
    const e = composeEmail({ logId: "L1", campaign, step: step({}), lead, account });
    expect(e.subject).toMatch(/^(Hi|Hey) Ana$/);
    expect(e.html).toContain("Hello Ana (CTO)");
    expect(e.html).toContain("https://app.test/t/c/L1?u=");
    expect(e.html).toContain("https://app.test/t/o/L1");
    expect(e.html).toContain("Jo<br>Send.io");
    expect(e.headers["List-Unsubscribe"]).toContain("/t/u/L1");
    expect(e.text).not.toContain("<");
    expect(e.text).toContain("https://acme.com/x");
    expect(e.text).not.toContain("/t/c/");
    expect(e.html).not.toMatch(/t\/c\/L1\?u=[^"]*t%2Fu%2F/); // unsubscribe link is not click-wrapped
    expect(e.messageId).toMatch(/@send\.io>$/);
  });
  it("threads follow-ups with blank subject", () => {
    const e = composeEmail({
      logId: "L2",
      campaign,
      step: step({ subject: "" }),
      lead,
      account,
      previous: { subject: "Hi Ana", messageId: "<m1@send.io>", references: [] },
    });
    expect(e.subject).toBe("Re: Hi Ana");
    expect(e.inReplyTo).toBe("<m1@send.io>");
    expect(e.references).toEqual(["<m1@send.io>"]);
  });
  it("plain text mode has no html", () => {
    const e = composeEmail({ logId: "L3", campaign: { ...campaign, sendAsPlainText: true }, step: step({}), lead, account });
    expect(e.html).toBeUndefined();
    expect(e.text).toContain("Hello Ana");
  });
  it("is deterministic per lead", () => {
    const a = composeEmail({ logId: "x", campaign, step: step({}), lead, account });
    const b = composeEmail({ logId: "y", campaign, step: step({}), lead, account });
    expect(a.subject).toBe(b.subject);
  });
});

describe("pickVariant", () => {
  it("distributes by weight", () => {
    const s = step({ abTestVariants: [{ id: "B", subject: "b", body: "b", weight: 50 }] as never });
    const counts: Record<string, number> = { A: 0, B: 0 };
    for (let i = 0; i < 1000; i++) counts[pickVariant(s, `lead-${i}`).id]++;
    expect(counts.A).toBeGreaterThan(400);
    expect(counts.B).toBeGreaterThan(400);
  });
});
