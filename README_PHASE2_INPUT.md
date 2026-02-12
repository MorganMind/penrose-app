# Phase 2 Input - Complete File Inventory

## Inventory

- package.json
- next.config.ts
- tsconfig.json
- postcss.config.mjs
- middleware.ts
- eslint.config.mjs
- app/layout.tsx
- app/page.tsx
- app/globals.css
- app/ConvexClientProvider.tsx
- app/api/auth/[...nextauth]/route.ts
- app/app/page.tsx
- app/signin/page.tsx

## package.json

```json
{
  "name": "penrose-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "convex:dev": "convex dev"
  },
  "dependencies": {
    "@auth/core": "^0.37.0",
    "@convex-dev/auth": "^0.0.90",
    "next": "16.1.6",
    "next-auth": "^5.0.0-beta.30",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "convex": "^1.31.7",
    "eslint": "^9",
    "eslint-config-next": "16.1.6",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

## next.config.ts

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

## postcss.config.mjs

```javascript
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

## middleware.ts

```typescript
import { convexAuthNextjsMiddleware, nextjsMiddlewareRedirect } from "@convex-dev/auth/nextjs/server";
import { NextRequest } from "next/server";

/**
 * Middleware to protect authenticated routes.
 * 
 * NOTE: The referer-based workaround below is a temporary solution for Phase 1.
 * It has a security flaw (referer can be spoofed) and should be replaced with
 * proper cookie syncing in future phases.
 */
export default convexAuthNextjsMiddleware(
  async (request: NextRequest, { convexAuth }) => {
    const pathname = request.nextUrl.pathname;
    
    // Allow access to sign-in page and API routes
    if (pathname.startsWith("/signin") || pathname.startsWith("/api")) {
      return;
    }
    
    // Protect routes that start with /app
    if (pathname.startsWith("/app")) {
      const isAuthenticated = await convexAuth.isAuthenticated();
      
      // TODO: Remove this workaround once cookie syncing is properly implemented
      // This is a temporary fix for Phase 1 to prevent redirect loops.
      // SECURITY NOTE: Referer header can be spoofed - this is not a secure solution.
      // In production, ensure ConvexAuthNextjsServerProvider properly syncs
      // localStorage tokens to HTTP-only cookies that middleware can read.
      const referer = request.headers.get("referer");
      if (referer && referer.includes("/signin") && !isAuthenticated) {
        // Allow one redirect attempt from sign-in to break the loop
        // This should be removed once cookie syncing works correctly
        return;
      }
      
      if (!isAuthenticated) {
        return nextjsMiddlewareRedirect(request, "/signin");
      }
    }
  }
);
```

## eslint.config.mjs

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

## app/layout.tsx

```typescript
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CMS Scaffold",
  description: "Multi-tenant blogging CMS",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ConvexAuthNextjsServerProvider verbose={process.env.NODE_ENV === "development"}>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ConvexAuthNextjsServerProvider>
      </body>
    </html>
  );
}
```

## app/page.tsx

```typescript
export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main>
        <h1>CMS scaffold running</h1>
      </main>
    </div>
  );
}
```

## app/globals.css

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: Arial, Helvetica, sans-serif;
}
```

## app/ConvexClientProvider.tsx

```typescript
"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
```

## app/api/auth/[...nextauth]/route.ts

```typescript
import { proxyAuthActionToConvex } from "@convex-dev/auth/nextjs/server";
import { NextRequest } from "next/server";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
}

export async function GET(request: NextRequest) {
  return proxyAuthActionToConvex(request, {
    convexUrl,
  });
}

export async function POST(request: NextRequest) {
  return proxyAuthActionToConvex(request, {
    convexUrl,
  });
}
```

## app/app/page.tsx

```typescript
export default function AppPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main>
        <h1>Protected app area</h1>
      </main>
    </div>
  );
}
```

## app/signin/page.tsx

```typescript
"use client";

import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";

const REDIRECT_DELAY_MS = 2000; // Time to wait for cookies to sync before redirecting

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const token = useAuthToken();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const hasRedirectedRef = useRef(false);
  
  const code = searchParams.get("code");
  const hasCode = !!code;
  
  // Process OAuth callback code
  useEffect(() => {
    if (code && !token && !isProcessing) {
      setIsProcessing(true);
      signIn("google", { code })
        .then(() => {
          // Remove code from URL to prevent re-processing
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete("code");
          window.history.replaceState({}, "", newUrl.toString());
        })
        .catch((err) => {
          const errorMessage = err instanceof Error ? err.message : "Unknown error";
          setError(`Sign in failed: ${errorMessage}`);
          setIsProcessing(false);
        });
    }
  }, [code, token, signIn, isProcessing]);
  
  // Redirect once authenticated (with delay to allow cookie syncing)
  useEffect(() => {
    if (token && !hasCode && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      const timeout = setTimeout(() => {
        window.location.href = "/app";
      }, REDIRECT_DELAY_MS);
      
      return () => clearTimeout(timeout);
    }
  }, [token, hasCode]);
  
  const handleSignIn = async () => {
    setError(null);
    try {
      const redirectUrl = `${window.location.origin}/signin`;
      const result = await signIn("google", { redirectTo: redirectUrl });
      
      if (result.signingIn) {
        // Immediate sign-in, redirect right away
        window.location.href = "/app";
      } else if (result.redirect) {
        // OAuth flow, redirect to provider
        window.location.href = result.redirect.toString();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to sign in";
      setError(errorMessage);
    }
  };

  // Loading state during OAuth callback processing
  if (hasCode && !token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="text-center">
          <h1 className="text-2xl font-semibold mb-4">Completing sign in...</h1>
          {error && (
            <p className="text-red-600 mt-4" role="alert">
              {error}
            </p>
          )}
        </main>
      </div>
    );
  }

  // Redirecting state
  if (token && !hasCode) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <main className="text-center">
          <h1 className="text-2xl font-semibold">Redirecting...</h1>
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
          <p className="text-red-600 mb-4" role="alert">
            {error}
          </p>
        )}
        <button
          onClick={handleSignIn}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          type="button"
        >
          Sign in with Google
        </button>
      </main>
    </div>
  );
}
```
