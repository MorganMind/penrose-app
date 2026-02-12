/**
 * ⚠️ AUTH FILE - ConvexAuthNextjsProvider. DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Create the client inside the component to ensure it's initialized with auth context
  // Enable verbose logging in development to debug auth token issues
  const convex = useMemo(
    () =>
      new ConvexReactClient(convexUrl!, {
        verbose: process.env.NODE_ENV === "development",
      }),
    []
  );

  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
