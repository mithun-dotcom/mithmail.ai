import OpenAI from "openai";
import { z } from "zod";
import type { ThreadSummaryStatus } from "@prisma/client";
import { spin } from "@/lib/template";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  return (client ??= new OpenAI());
}
const model = () => process.env.OPENAI_MODEL ?? "gpt-4o";
export const aiEnabled = () => !!process.env.OPENAI_API_KEY;

async function json<T>(schema: z.ZodType<T>, system: string, user: string, temperature = 0.7): Promise<T> {
  const res = await openai().chat.completions.create({
    model: model(),
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "{}";
  return schema.parse(JSON.parse(raw));
}

// ---------------------------------------------------------------------------
// Sequence writer
// ---------------------------------------------------------------------------

export const generatedStepSchema = z.object({
  subject: z.string(),
  body: z.string(),
  waitDays: z.number().int().min(0).max(30),
});
export type GeneratedStep = z.infer<typeof generatedStepSchema>;

export interface SequenceBrief {
  prompt: string; // offer / ICP / value prop in the user's words
  steps?: number;
  tone?: string;
  useSpintax?: boolean;
}

const SEQUENCE_SYSTEM = `You are an expert B2B cold email copywriter who writes short, human, plain-text emails that land in the primary inbox.
Rules:
- Each email under 120 words. No images, no links in step 1, no spammy words (free, guarantee, act now, $$$).
- Personalise with merge tags: {{first_name}}, {{company_name}} and any others the user mentions. Always give first_name a fallback: {{first_name|there}}.
- Follow-ups are replies in the same thread: leave "subject" as "" for follow-ups so it threads under step 1.
- Use soft, low-friction calls to action (interest-based questions).
- waitDays is the delay after the previous step (0 for step 1, typically 2-4 for follow-ups).
Return JSON: {"steps":[{"subject":string,"body":string,"waitDays":number}]}`;

export async function generateSequence(brief: SequenceBrief): Promise<GeneratedStep[]> {
  const steps = Math.min(Math.max(brief.steps ?? 3, 1), 7);
  const user = [
    `Write a ${steps}-step cold email sequence.`,
    `Brief: ${brief.prompt}`,
    brief.tone ? `Tone: ${brief.tone}` : "",
    brief.useSpintax
      ? "Add spintax to greetings and a few phrases using {option a|option b} syntax so each email is unique. Never put merge tags' double braces inside a spintax option boundary incorrectly."
      : "",
    "Body is plain text with blank lines between paragraphs. Do not include a signature — it is appended automatically.",
  ]
    .filter(Boolean)
    .join("\n");
  const out = await json(z.object({ steps: z.array(generatedStepSchema).min(1) }), SEQUENCE_SYSTEM, user);
  return out.steps.slice(0, steps).map((s, i) => ({ ...s, waitDays: i === 0 ? 0 : s.waitDays || 3 }));
}

// ---------------------------------------------------------------------------
// Reply categorisation (Unibox labels)
// ---------------------------------------------------------------------------

const LABELS = ["INTERESTED", "MEETING_BOOKED", "NOT_INTERESTED", "OUT_OF_OFFICE", "WRONG_PERSON", "UNSUBSCRIBE_REQUEST", "NEUTRAL"] as const;

/** Cheap rule-based classifier used when AI is disabled, and as a pre-filter for obvious cases. */
export function classifyReplyHeuristic(text: string): ThreadSummaryStatus | null {
  const t = text.toLowerCase();
  if (/(out of (the )?office|on (annual )?leave|vacation|auto-?reply|automatic reply|away until|limited access to email)/.test(t)) return "OUT_OF_OFFICE";
  if (/(unsubscribe|remove me|stop emailing|take me off|do not contact|don't contact)/.test(t)) return "UNSUBSCRIBE_REQUEST";
  if (/(no longer (with|at)|left the company|not the right person|wrong person|no longer works)/.test(t)) return "WRONG_PERSON";
  if (/(calendly\.com|booked|see you (on|then)|invite sent|sent (you )?an invite)/.test(t)) return "MEETING_BOOKED";
  if (/(not interested|no thanks|no thank you|not a fit|we're good|we are good|pass on this)/.test(t)) return "NOT_INTERESTED";
  if (/(interested|let's (talk|chat)|sounds good|tell me more|send (me )?(more )?info|happy to chat|what does your .* look like)/.test(t)) return "INTERESTED";
  return null;
}

export async function classifyReply(text: string): Promise<ThreadSummaryStatus> {
  const quick = classifyReplyHeuristic(text);
  if (!aiEnabled()) return quick ?? "NEUTRAL";
  if (quick === "OUT_OF_OFFICE" || quick === "UNSUBSCRIBE_REQUEST") return quick;
  try {
    const out = await json(
      z.object({ label: z.enum(LABELS) }),
      `Classify a reply to a cold sales email. Labels: ${LABELS.join(", ")}. MEETING_BOOKED only if a time is agreed or a calendar invite is mentioned. Return JSON {"label": "..."}.`,
      text.slice(0, 4000),
      0,
    );
    return out.label;
  } catch {
    return quick ?? "NEUTRAL";
  }
}

// ---------------------------------------------------------------------------
// Warm-up content
// ---------------------------------------------------------------------------

const WARMUP_TOPICS = [
  "planning next quarter's priorities",
  "a book recommendation",
  "feedback on a draft document",
  "rescheduling a coffee catch-up",
  "notes from a recent webinar",
  "an idea for the team offsite",
  "a quick question about a spreadsheet",
  "thanks for help on a project",
];

export async function generateWarmupEmail(): Promise<{ subject: string; body: string }> {
  const topic = WARMUP_TOPICS[Math.floor(Math.random() * WARMUP_TOPICS.length)];
  if (aiEnabled()) {
    try {
      return await json(
        z.object({ subject: z.string(), body: z.string() }),
        'Write a short, natural, friendly email between two colleagues (40-90 words). No links, no sales. Return JSON {"subject","body"}.',
        `Topic: ${topic}`,
        1,
      );
    } catch {
      /* fall through to template */
    }
  }
  return {
    subject: spin(`{Quick|Short|Small} {note|question} on ${topic}`),
    body: spin(`{Hi|Hey|Hello},\n\nI {wanted|meant} to follow up about ${topic}. Let me know what you think when you get a {moment|minute} — no rush at all.\n\n{Thanks|Cheers}!`),
  };
}

export async function generateWarmupReply(original: string): Promise<string> {
  if (aiEnabled()) {
    try {
      const out = await json(
        z.object({ body: z.string() }),
        'Reply briefly and naturally (20-60 words) to this email from a colleague. No links. Return JSON {"body"}.',
        original.slice(0, 2000),
        1,
      );
      return out.body;
    } catch {
      /* fall through */
    }
  }
  return spin("{Thanks for this|Appreciate the note|Got it, thank you} — {sounds good to me|let's pick it up later this week|I'll take a look}!");
}
