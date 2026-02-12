/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * OAuth code exchange is handled by the Next.js middleware (convexAuthNextjsMiddleware).
 * When the user lands on /signin?code=xxx, the middleware exchanges the code and redirects
 * to /signin (without code) with auth cookies set. The client never sees the code.
 * We only redirect to /app when we have a token (from serverState/cookies).
 */
const REDIRECT_DELAY_MS = 500; // Brief delay for hydration

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const token = useAuthToken();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") || "/app";

  // Redirect once authenticated (token comes from serverState/cookies set by middleware)
  useEffect(() => {
    if (token) {
      const timeout = setTimeout(() => {
        const destUrl = new URL(redirectTo, window.location.origin);
        destUrl.searchParams.set("from_login", "true");
        window.location.href = destUrl.toString();
      }, REDIRECT_DELAY_MS);
      return () => clearTimeout(timeout);
    }
  }, [token, redirectTo]);
  
  const handleSignIn = async () => {
    setError(null);
    
    // If there's already a token but user is on sign-in page, clear it first
    if (token) {
      if (process.env.NODE_ENV === "development") {
        console.log("handleSignIn: Token present, clearing before sign-in");
      }
      // Clear any existing token/localStorage
      localStorage.removeItem("__convexAuth");
      localStorage.removeItem("__Host-convexAuth");
      // Force a page reload to clear state
      window.location.reload();
      return;
    }
    
    try {
      // Pass the final destination to the provider so it comes back in the callback
      const callbackUrl = new URL(`${window.location.origin}/signin`);
      if (redirectTo) {
        callbackUrl.searchParams.set("redirectTo", redirectTo);
      }
      
      if (process.env.NODE_ENV === "development") {
        console.log("handleSignIn: Calling signIn with callbackUrl:", callbackUrl.toString());
      }
      
      const result = await signIn("google", { redirectTo: callbackUrl.toString() });
      
      if (process.env.NODE_ENV === "development") {
        console.log("handleSignIn: Result:", result);
      }
      
      if (result.redirect) {
        // OAuth flow, redirect to provider
        if (process.env.NODE_ENV === "development") {
          console.log("handleSignIn: OAuth flow, redirecting to:", result.redirect.toString());
        }
        window.location.href = result.redirect.toString();
      } else if (result.signingIn) {
        // Immediate sign-in (shouldn't happen for OAuth, but handle it)
        if (process.env.NODE_ENV === "development") {
          console.log("handleSignIn: Immediate sign-in, redirecting to:", redirectTo);
        }
        const destUrl = new URL(redirectTo, window.location.origin);
        destUrl.searchParams.set("from_login", "true");
        window.location.href = destUrl.toString();
      } else {
        // No redirect URL - this shouldn't happen
        const errorMsg = "Sign in failed: No redirect URL returned";
        if (process.env.NODE_ENV === "development") {
          console.error("handleSignIn: Unexpected result - no redirect:", result);
        }
        setError(errorMsg);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to sign in";
      if (process.env.NODE_ENV === "development") {
        console.error("handleSignIn: Error:", err);
      }
      setError(errorMessage);
    }
  };

  // Loading: middleware is exchanging code and will redirect, or we're redirecting
  if (code || token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="text-center">
          <h1 className="text-2xl font-semibold mb-4">
            {code ? "Completing sign in..." : "Redirecting..."}
          </h1>
          {error && (
            <p className="text-gray-600 mt-4" role="alert">
              {error}
            </p>
          )}
          <p className="text-gray-500 text-sm mt-2">Taking you to {redirectTo}</p>
        </main>
      </div>
    );
  }

  // Sign-in form
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="text-center">
        <h1 className="text-2xl font-semibold mb-6">Sign In</h1>
        {error && (
          <p className="text-gray-600 mb-4" role="alert">
            {error}
          </p>
        )}
        <button
          onClick={handleSignIn}
          className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          type="button"
        >
          Sign in with Google
        </button>
      </main>
    </div>
  );
}
