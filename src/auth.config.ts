import type { NextAuthConfig } from "next-auth";

// Edge-safe config shared by middleware and the full Auth.js instance.
export const authConfig = {
  pages: { signIn: "/login", verifyRequest: "/login?check-email=1" },
  session: { strategy: "jwt" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname === "/" ||
        pathname.startsWith("/login") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/t/") || // tracking pixel / click / unsubscribe
        pathname.startsWith("/api/v1"); // public API (API-key auth)
      return isPublic || !!auth?.user;
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
