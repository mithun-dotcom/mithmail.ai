import { randomUUID } from "node:crypto";
import type { Campaign, CampaignStep, EmailAccount, Lead, TrackingDomain } from "@prisma/client";
import { z } from "zod";
import { variantSchema, type Variant } from "@/lib/campaign-types";
import { htmlToText, render, seededRng, textToHtml, type Vars } from "@/lib/template";
import { dayOfWeek, timeOfDay } from "@/lib/schedule";
import { injectPixel, linkify, openPixelUrl, rewriteLinks, trackingBaseUrl, unsubscribeUrl } from "@/lib/tracking";
import { domainOf } from "@/lib/utils";

export interface ComposeInput {
  logId: string;
  campaign: Campaign;
  step: CampaignStep;
  lead: Lead;
  account: EmailAccount & { trackingDomain: TrackingDomain | null };
  previous?: { subject: string | null; messageId: string | null; references: string[] } | null;
  now?: Date;
}

export interface ComposedEmail {
  messageId: string;
  variantId: string;
  from: { name: string; address: string };
  to: string;
  subject: string;
  html?: string;
  text: string;
  /** Rendered body without tracking pixel/links or unsubscribe footer — what the Unibox shows. */
  displayHtml: string;
  headers: Record<string, string>;
  inReplyTo?: string;
  references?: string[];
}

/** Weighted pick between the base step (variant "A", weight 50) and its A/B variants. Deterministic per lead+step. */
export function pickVariant(step: CampaignStep, seed: string): { id: string; subject: string; body: string } {
  const variants = z.array(variantSchema).catch([]).parse(step.abTestVariants ?? []);
  const options: (Variant & { id: string })[] = [
    { id: "A", subject: step.subject ?? "", body: step.bodySpintax ?? step.bodyHtml ?? "", weight: 50 },
    ...variants.filter((v) => v.weight > 0),
  ];
  const total = options.reduce((n, o) => n + o.weight, 0);
  let r = seededRng(`${seed}:variant`)() * total;
  for (const o of options) {
    r -= o.weight;
    if (r < 0) return o;
  }
  return options[0];
}

const looksLikeHtml = (s: string) => /<(p|div|br|a|b|strong|i|em|ul|ol|li|table|span|h\d)\b/i.test(s);

export function leadVars(lead: Lead, account: EmailAccount, tz: string, now: Date): Vars {
  const custom = (lead.customVariables as Record<string, string> | null) ?? {};
  return {
    ...custom,
    first_name: lead.firstName,
    last_name: lead.lastName,
    email: lead.email,
    company_name: lead.companyName,
    company: lead.companyName,
    linkedin_url: lead.linkedinUrl,
    sender_name: account.fromName ?? account.emailAddress.split("@")[0],
    sender_email: account.emailAddress,
    day_of_week: dayOfWeek(now, tz),
    time_of_day: timeOfDay(now, tz),
  };
}

export function composeEmail(input: ComposeInput): ComposedEmail {
  const { logId, campaign, step, lead, account, previous } = input;
  const now = input.now ?? new Date();
  const rng = seededRng(`${lead.id}:${step.id}`);
  const variant = pickVariant(step, `${lead.id}:${step.id}`);
  const vars = leadVars(lead, account, campaign.scheduleTimezone, now);

  // Subject: blank follow-up subject => reply in the same thread.
  let subject = render(variant.subject, vars, rng).trim();
  const threaded = !subject && !!previous?.subject;
  if (threaded) subject = /^re:/i.test(previous!.subject!) ? previous!.subject! : `Re: ${previous!.subject}`;

  const rawBody = render(variant.body, vars, rng);
  let html = looksLikeHtml(rawBody) ? rawBody : linkify(textToHtml(rawBody));
  if (account.signature) {
    const sig = render(account.signature, vars, rng);
    html += looksLikeHtml(sig) ? `<br>${sig}` : `<br>${textToHtml(sig)}`;
  }

  const base = trackingBaseUrl(account.trackingDomain);
  const headers: Record<string, string> = { "X-Mailer-Campaign": campaign.id.slice(0, 8) };
  const plainOnly = campaign.sendAsPlainText;

  // Tracking is applied to the HTML part only; the text part keeps the real URLs.
  const displayHtml = html;
  let text = htmlToText(html);
  if (!plainOnly && campaign.trackClicks) html = rewriteLinks(html, base, logId);

  if (campaign.includeUnsubscribe) {
    const u = unsubscribeUrl(base, logId);
    html += `<p style="font-size:12px;color:#888">If you'd rather not hear from me, <a href="${u}">let me know</a>.</p>`;
    text += `\n\nIf you'd rather not hear from me: ${u}`;
    headers["List-Unsubscribe"] = `<${u}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (!plainOnly && campaign.trackOpens) html = injectPixel(html, openPixelUrl(base, logId));

  const messageId = `<${randomUUID()}@${domainOf(account.emailAddress) || "mithmill.local"}>`;
  const references = previous?.messageId ? [...previous.references, previous.messageId] : undefined;

  return {
    messageId,
    variantId: variant.id,
    from: { name: account.fromName ?? "", address: account.emailAddress },
    to: lead.email,
    subject,
    html: plainOnly ? undefined : `<div>${html}</div>`,
    text,
    displayHtml,
    headers,
    inReplyTo: threaded || previous?.messageId ? previous?.messageId ?? undefined : undefined,
    references,
  };
}
