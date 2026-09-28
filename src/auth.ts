import { createHash, timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Nodemailer from "next-auth/providers/nodemailer";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import { authConfig } from "./auth.config";

const providers: Provider[] = [];

if (process.env.AUTH_GOOGLE_ID) providers.push(Google({ allowDangerousEmailAccountLinking: true }));
if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID) {
  providers.push(
    MicrosoftEntraID({
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}
if (process.env.EMAIL_SERVER) {
  providers.push(Nodemailer({ server: process.env.EMAIL_SERVER, from: process.env.EMAIL_FROM }));
}

// Single admin login for a fresh deployment (no OAuth / email server yet):
// set ADMIN_LOGIN_EMAIL and ADMIN_LOGIN_PASSWORD (12+ characters).
const adminEmail = process.env.ADMIN_LOGIN_EMAIL?.toLowerCase().trim();
const adminPassword = process.env.ADMIN_LOGIN_PASSWORD ?? "";
export const adminLoginEnabled = !!adminEmail && adminPassword.length >= 12;
if (adminLoginEnabled) {
  providers.push(
    Credentials({
      id: "admin",
      name: "Admin login",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").toLowerCase().trim();
        const given = createHash("sha256").update(String(creds?.password ?? "")).digest();
        const expected = createHash("sha256").update(adminPassword).digest();
        if (email !== adminEmail || !timingSafeEqual(given, expected)) return null;
        return db.user.upsert({ where: { email }, update: {}, create: { email, name: email.split("@")[0], role: "SUPER_ADMIN" } });
      },
    }),
  );
}

// Local development only: sign in with any email, no password.
export const devLoginEnabled = process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_LOGIN === "1";
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").toLowerCase().trim();
        if (!email.includes("@")) return null;
        return db.user.upsert({
          where: { email },
          update: {},
          create: { email, name: email.split("@")[0] },
        });
      },
    }),
  );
}

export const enabledProviders = {
  google: !!process.env.AUTH_GOOGLE_ID,
  microsoft: !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
  email: !!process.env.EMAIL_SERVER,
  dev: devLoginEnabled,
  admin: adminLoginEnabled,
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers,
});
