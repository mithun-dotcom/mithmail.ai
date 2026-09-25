/**
 * Demo data for local development:  npm run db:seed
 * Creates a user (demo@mithmill.test — use the dev login), a workspace, three SMTP inboxes
 * pointed at the dev SMTP server (scripts/dev-smtp.ts), 25 leads and a 3-step campaign.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { PrismaClient } from "@prisma/client";
import { encrypt } from "../src/lib/crypto";
import { PLANS } from "../src/lib/plans";

const db = new PrismaClient();

const FIRST = ["Ana", "Ben", "Chloe", "Dev", "Elena", "Farid", "Grace", "Hiro", "Ines", "Jonah"];
const COMPANIES = ["Northwind", "Globex", "Initech", "Umbrella", "Hooli", "Stark", "Wayne", "Acme", "Vandelay", "Pied Piper"];

async function main() {
  const user = await db.user.upsert({ where: { email: "demo@mithmill.test" }, create: { email: "demo@mithmill.test", name: "Demo Founder" }, update: {} });
  const ws = await db.workspace.upsert({
    where: { slug: "demo" },
    create: {
      name: "Demo Outbound",
      slug: "demo",
      subscriptionTier: "GROWTH",
      maxInboxes: PLANS.GROWTH.maxInboxes,
      monthlyEmailQuota: PLANS.GROWTH.monthlyEmailQuota,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
    update: {},
  });

  const inboxes = [];
  for (const [email, provider] of [["alex@getdemo.io", "SMTP"], ["sam@trydemo.io", "GOOGLE"], ["kim@demohq.io", "MICROSOFT"]] as const) {
    inboxes.push(
      await db.emailAccount.upsert({
        where: { workspaceId_emailAddress: { workspaceId: ws.id, emailAddress: email } },
        create: {
          workspaceId: ws.id,
          emailAddress: email,
          fromName: email.split("@")[0].replace(/^./, (c) => c.toUpperCase()),
          provider,
          smtpHost: "localhost",
          smtpPort: 2525,
          smtpUser: email,
          smtpPassEnc: encrypt("dev"),
          imapHost: "localhost",
          imapPort: 1143,
          imapUser: email,
          imapPassEnc: encrypt("dev"),
          dailyLimit: 30,
          minDelaySeconds: 5,
          maxDelaySeconds: 20,
          signature: "Best,\n{{sender_name}}",
        },
        update: {},
      }),
    );
  }

  const leads = [];
  for (let i = 0; i < 25; i++) {
    const first = FIRST[i % FIRST.length];
    const company = COMPANIES[(i * 3) % COMPANIES.length];
    const domain = i % 3 === 0 ? "gmail.com" : i % 3 === 1 ? "outlook.com" : `${company.toLowerCase().replace(/\s/g, "")}.com`;
    const email = `${first.toLowerCase()}.${i}@${domain}`;
    leads.push(
      await db.lead.upsert({
        where: { workspaceId_email: { workspaceId: ws.id, email } },
        create: {
          workspaceId: ws.id,
          email,
          firstName: first,
          companyName: company,
          esp: domain === "gmail.com" ? "GOOGLE" : domain === "outlook.com" ? "MICROSOFT" : "OTHER",
          customVariables: { "Job Title": ["CEO", "VP Sales", "Head of Growth"][i % 3] },
        },
        update: {},
      }),
    );
  }

  const existing = await db.campaign.findFirst({ where: { workspaceId: ws.id, name: "Demo — SaaS founders" } });
  if (!existing) {
    await db.campaign.create({
      data: {
        workspaceId: ws.id,
        name: "Demo — SaaS founders",
        schedule: { create: { daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" } },
        steps: {
          create: [
            { stepNumber: 1, waitDays: 0, subject: "{Quick question|Idea} for {{company_name}}", bodySpintax: "{Hi|Hey} {{first_name|there}},\n\nAs {{Job Title}} at {{company_name}}, how are you handling outbound today?\n\nWe help teams book more meetings by spreading volume across many warmed inboxes.\n\nWorth a quick chat?" },
            { stepNumber: 2, waitDays: 3, subject: "", bodySpintax: "{Hi|Hey} {{first_name|there}}, just bumping this up in case it got buried." },
            { stepNumber: 3, waitDays: 4, subject: "", bodySpintax: "Last note from me, {{first_name|there}} — should I close the loop?" },
          ],
        },
        emailAccounts: { create: inboxes.map((a) => ({ emailAccountId: a.id })) },
        campaignLeads: { create: leads.map((l) => ({ leadId: l.id })) },
      },
    });
  }
  console.log(`Seeded workspace "${ws.name}" — sign in with the dev login as demo@mithmill.test`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
