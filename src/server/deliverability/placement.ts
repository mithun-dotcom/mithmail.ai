import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { domainOf } from "@/lib/utils";
import { transportFor } from "@/server/mail/pool";
import { getQueue, QUEUES, type PlacementJob } from "@/server/queue";

export const PLACEMENT_HEADER = "x-mithmill-placement";

const seedSchema = z.array(
  z.object({
    email: z.string().email(),
    provider: z.string(), // label shown in the UI: Gmail, Outlook, Yahoo, …
    imapHost: z.string(),
    imapPort: z.number().default(993),
    user: z.string().optional(),
    pass: z.string(),
  }),
);
export type Seed = z.infer<typeof seedSchema>[number];

/** Seed mailboxes are operator-owned inboxes at the major providers, configured via PLACEMENT_SEEDS (JSON). */
export function placementSeeds(): Seed[] {
  try {
    return seedSchema.parse(JSON.parse(process.env.PLACEMENT_SEEDS ?? "[]"));
  } catch {
    return [];
  }
}

export interface PlacementResult {
  seed: string;
  provider: string;
  folder: "INBOX" | "SPAM" | "MISSING" | "ERROR";
}

export async function startPlacementTest(workspaceId: string, emailAccountId: string) {
  const seeds = placementSeeds();
  if (!seeds.length) throw new Error("No placement seed inboxes are configured (PLACEMENT_SEEDS).");
  const account = await db.emailAccount.findFirstOrThrow({ where: { id: emailAccountId, workspaceId } });

  const token = randomUUID().slice(0, 8);
  const test = await db.placementTest.create({
    data: { workspaceId, emailAccountId, status: "RUNNING", subject: `Quick question ${token}` },
  });
  const transport = await transportFor(account);
  for (const seed of seeds) {
    await transport.sendMail({
      from: account.fromName ? { name: account.fromName, address: account.emailAddress } : account.emailAddress,
      to: seed.email,
      subject: test.subject,
      text: "Hi,\n\nDo you have a few minutes this week to compare notes on outbound? Happy to share what's working for us.\n\nThanks",
      messageId: `<${randomUUID()}@${domainOf(account.emailAddress)}>`,
      headers: { [PLACEMENT_HEADER]: test.id },
    });
  }
  await getQueue(QUEUES.placement).add("check", { kind: "check", testId: test.id, attempt: 1 } satisfies PlacementJob, { delay: 3 * 60_000 });
  return test;
}

async function locate(seed: Seed, testId: string): Promise<PlacementResult["folder"]> {
  const client = new ImapFlow({
    host: seed.imapHost,
    port: seed.imapPort,
    secure: seed.imapPort === 993,
    auth: { user: seed.user ?? seed.email, pass: seed.pass },
    logger: false,
  });
  await client.connect();
  try {
    const boxes = await client.list();
    const spam = boxes.find((b) => b.specialUse === "\\Junk") ?? boxes.find((b) => /^(spam|junk|bulk)/i.test(b.name));
    for (const [path, folder] of [["INBOX", "INBOX"], ...(spam ? [[spam.path, "SPAM"]] : [])] as [string, "INBOX" | "SPAM"][]) {
      const lock = await client.getMailboxLock(path);
      try {
        const hits = await client.search({ header: { [PLACEMENT_HEADER]: testId } }, { uid: true });
        if (hits && hits.length) return folder;
      } finally {
        lock.release();
      }
    }
    return "MISSING";
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function checkPlacementTest(testId: string, attempt: number) {
  const test = await db.placementTest.findUnique({ where: { id: testId } });
  if (!test || test.status !== "RUNNING") return;
  const results: PlacementResult[] = [];
  for (const seed of placementSeeds()) {
    const folder = await locate(seed, testId).catch(() => "ERROR" as const);
    results.push({ seed: seed.email, provider: seed.provider, folder });
  }
  const missing = results.filter((r) => r.folder === "MISSING").length;
  if (missing && attempt < 3) {
    await getQueue(QUEUES.placement).add("check", { kind: "check", testId, attempt: attempt + 1 } satisfies PlacementJob, { delay: 5 * 60_000 });
    await db.placementTest.update({ where: { id: testId }, data: { results: results as unknown as Prisma.InputJsonValue } });
    return;
  }
  const found = results.filter((r) => r.folder === "INBOX" || r.folder === "SPAM").length;
  const inbox = results.filter((r) => r.folder === "INBOX").length;
  await db.placementTest.update({
    where: { id: testId },
    data: {
      status: "COMPLETED",
      results: results as unknown as Prisma.InputJsonValue,
      inboxRate: results.length ? Math.round((inbox / results.length) * 1000) / 10 : null,
      completedAt: new Date(),
    },
  });
  return { found, inbox };
}
