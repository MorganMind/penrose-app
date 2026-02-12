/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 * Auth is fragile. See .cursorrules and README.
 */
import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";

/**
 * Convex Auth configuration.
 * Pass provider reference - Convex Auth reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET automatically.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async redirect({ redirectTo }) {
      if (redirectTo?.startsWith("http")) return redirectTo;
      const nextJsUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return redirectTo ? `${nextJsUrl}${redirectTo}` : `${nextJsUrl}/app`;
    },
  },
});
