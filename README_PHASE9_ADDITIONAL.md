# Phase 9 — Files Not in Phase 8 (with full contents)

Only files that appear in the Phase 9 input snapshot and were **not** listed in Phase 8.  
*(Phase 8 used `app/(app)/app/[orgSlug]/pages/page.tsx`; Phase 9 uses `posts/page.tsx` and `posts/new/page.tsx`.)*

---

## convex/auth.ts

```ts
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
```

---

## convex/http.ts

```ts
/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Add all auth routes (OAuth callbacks, JWT verification, etc.)
auth.addHttpRoutes(http);

export default http;
```

---

## convex/lib/slugify.ts

```ts
/**
 * Turn a human title into a URL-safe slug.
 * 
 * Strips everything except lowercase alphanumerics and hyphens,
 * collapses runs of hyphens, trims leading/trailing hyphens,
 * and caps length at 100 characters.
 * 
 * @param text - The text to slugify
 * @returns A URL-safe slug string
 * 
 * @example
 *   slugify("Hello World!") // "hello-world"
 *   slugify("  Test---Post  ") // "test-post"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
```

---

## convex/testEnv.ts

```ts
import { action } from "./_generated/server";

/**
 * Temporary test action to verify environment variables are accessible in Convex
 */
export const checkEnvVars = action(async () => {
  const googleId = process.env.AUTH_GOOGLE_ID;
  const googleSecret = process.env.AUTH_GOOGLE_SECRET;
  
  return {
    hasGoogleId: !!googleId,
    hasGoogleSecret: !!googleSecret,
    googleIdLength: googleId?.length || 0,
    googleSecretLength: googleSecret?.length || 0,
    // Don't log the actual secrets, just confirm they exist
    allEnvVars: Object.keys(process.env).filter(key => 
      key.includes("GOOGLE") || key.includes("AUTH")
    ),
  };
});
```

---

## convex/README.md

```markdown
# Welcome to your Convex functions directory!

Write your Convex functions here.
See https://docs.convex.dev/functions for more.

A query function that takes two arguments looks like:

\`\`\`ts
// convex/myFunctions.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const myQueryFunction = query({
  // Validators for arguments.
  args: {
    first: v.number(),
    second: v.string(),
  },

  // Function implementation.
  handler: async (ctx, args) => {
    // Read the database as many times as you need here.
    // See https://docs.convex.dev/database/reading-data.
    const documents = await ctx.db.query("tablename").collect();

    // Arguments passed from the client are properties of the args object.
    console.log(args.first, args.second);

    // Write arbitrary JavaScript here: filter, aggregate, build derived data,
    // remove non-public properties, or create new objects.
    return documents;
  },
});
\`\`\`

Using this query function in a React component looks like:

\`\`\`ts
const data = useQuery(api.myFunctions.myQueryFunction, {
  first: 10,
  second: "hello",
});
\`\`\`

A mutation function looks like:

\`\`\`ts
// convex/myFunctions.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const myMutationFunction = mutation({
  // Validators for arguments.
  args: {
    first: v.string(),
    second: v.string(),
  },

  // Function implementation.
  handler: async (ctx, args) => {
    // Insert or modify documents in the database here.
    // Mutations can also read from the database like queries.
    // See https://docs.convex.dev/database/writing-data.
    const message = { body: args.first, author: args.second };
    const id = await ctx.db.insert("messages", message);

    // Optionally, return a value from your mutation.
    return await ctx.db.get("messages", id);
  },
});
\`\`\`

Using this mutation function in a React component looks like:

\`\`\`ts
const mutation = useMutation(api.myFunctions.myMutationFunction);
function handleButtonPress() {
  // fire and forget, the most common way to use mutations
  mutation({ first: "Hello!", second: "me" });
  // OR
  // use the result once the mutation has completed
  mutation({ first: "Hello!", second: "me" }).then((result) =>
    console.log(result),
  );
}
\`\`\`

Use the Convex CLI to push your functions to a deployment. See everything
the Convex CLI can do by running \`npx convex -h\` in your project root
directory. To learn more, launch the docs with \`npx convex docs\`.
```

---

## convex/_generated/api.d.ts

```ts
/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as lib_slugify from "../lib/slugify.js";
import type * as orgs from "../orgs.js";
import type * as posts from "../posts.js";
import type * as sites from "../sites.js";
import type * as testEnv from "../testEnv.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  http: typeof http;
  "lib/slugify": typeof lib_slugify;
  orgs: typeof orgs;
  posts: typeof posts;
  sites: typeof sites;
  testEnv: typeof testEnv;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
```

---

## convex/_generated/dataModel.d.ts

```ts
/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
} from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

/**
 * The names of all of your Convex tables.
 */
export type TableNames = TableNamesInDataModel<DataModel>;

/**
 * The type of a document stored in Convex.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;

/**
 * An identifier for a document in Convex.
 *
 * Convex documents are uniquely identified by their `Id`, which is accessible
 * on the `_id` field. To learn more, see [Document IDs](https://docs.convex.dev/using/document-ids).
 *
 * Documents can be loaded using `db.get(tableName, id)` in query and mutation functions.
 *
 * IDs are just strings at runtime, but this type can be used to distinguish them from other
 * strings when type checking.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;

/**
 * A type describing your Convex data model.
 *
 * This type includes information about what tables you have, the type of
 * documents stored in those tables, and the indexes defined on them.
 *
 * This type is used to parameterize methods like `queryGeneric` and
 * `mutationGeneric` to make them type-safe.
 */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
```

---

## convex/_generated/server.d.ts

```ts
/* eslint-disable */
/**
 * Generated utilities for implementing server-side Convex query and mutation functions.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import {
  ActionBuilder,
  HttpActionBuilder,
  MutationBuilder,
  QueryBuilder,
  GenericActionCtx,
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDatabaseReader,
  GenericDatabaseWriter,
} from "convex/server";
import type { DataModel } from "./dataModel.js";

/**
 * Define a query in this Convex app's public API.
 *
 * This function will be allowed to read your Convex database and will be accessible from the client.
 *
 * @param func - The query function. It receives a {@link QueryCtx} as its first argument.
 * @returns The wrapped query. Include this as an `export` to name it and make it accessible.
 */
export declare const query: QueryBuilder<DataModel, "public">;

/**
 * Define a query that is only accessible from other Convex functions (but not from the client).
 *
 * This function will be allowed to read from your Convex database. It will not be accessible from the client.
 *
 * @param func - The query function. It receives a {@link QueryCtx} as its first argument.
 * @returns The wrapped query. Include this as an `export` to name it and make it accessible.
 */
export declare const internalQuery: QueryBuilder<DataModel, "internal">;

/**
 * Define a mutation in this Convex app's public API.
 *
 * This function will be allowed to modify your Convex database and will be accessible from the client.
 *
 * @param func - The mutation function. It receives a {@link MutationCtx} as its first argument.
 * @returns The wrapped mutation. Include this as an `export` to name it and make it accessible.
 */
export declare const mutation: MutationBuilder<DataModel, "public">;

/**
 * Define a mutation that is only accessible from other Convex functions (but not from the client).
 *
 * This function will be allowed to modify your Convex database. It will not be accessible from the client.
 *
 * @param func - The mutation function. It receives a {@link MutationCtx} as its first argument.
 * @returns The wrapped mutation. Include this as an `export` to name it and make it accessible.
 */
export declare const internalMutation: MutationBuilder<DataModel, "internal">;

/**
 * Define an action in this Convex app's public API.
 *
 * An action is a function which can execute any JavaScript code, including non-deterministic
 * code and code with side-effects, like calling third-party services.
 * They can be run in Convex's JavaScript environment or in Node.js using the "use node" directive.
 * They can interact with the database indirectly by calling queries and mutations using the {@link ActionCtx}.
 *
 * @param func - The action. It receives an {@link ActionCtx} as its first argument.
 * @returns The wrapped action. Include this as an `export` to name it and make it accessible.
 */
export declare const action: ActionBuilder<DataModel, "public">;

/**
 * Define an action that is only accessible from other Convex functions (but not from the client).
 *
 * @param func - The function. It receives an {@link ActionCtx} as its first argument.
 * @returns The wrapped function. Include this as an `export` to name it and make it accessible.
 */
export declare const internalAction: ActionBuilder<DataModel, "internal">;

/**
 * Define an HTTP action.
 *
 * The wrapped function will be used to respond to HTTP requests received
 * by a Convex deployment if the requests matches the path and method where
 * this action is routed. Be sure to route your httpAction in `convex/http.js`.
 *
 * @param func - The function. It receives an {@link ActionCtx} as its first argument
 * and a Fetch API `Request` object as its second.
 * @returns The wrapped function. Import this function from `convex/http.js` and route it to hook it up.
 */
export declare const httpAction: HttpActionBuilder;

/**
 * A set of services for use within Convex query functions.
 *
 * The query context is passed as the first argument to any Convex query
 * function run on the server.
 *
 * This differs from the {@link MutationCtx} because all of the services are
 * read-only.
 */
export type QueryCtx = GenericQueryCtx<DataModel>;

/**
 * A set of services for use within Convex mutation functions.
 *
 * The mutation context is passed as the first argument to any Convex mutation
 * function run on the server.
 */
export type MutationCtx = GenericMutationCtx<DataModel>;

/**
 * A set of services for use within Convex action functions.
 *
 * The action context is passed as the first argument to any Convex action
 * function run on the server.
 */
export type ActionCtx = GenericActionCtx<DataModel>;

/**
 * An interface to read from the database within Convex query functions.
 *
 * The two entry points are {@link DatabaseReader.get}, which fetches a single
 * document by its {@link Id}, or {@link DatabaseReader.query}, which starts
 * building a query.
 */
export type DatabaseReader = GenericDatabaseReader<DataModel>;

/**
 * An interface to read from and write to the database within Convex mutation
 * functions.
 *
 * Convex guarantees that all writes within a single mutation are
 * executed atomically, so you never have to worry about partial writes leaving
 * your data in an inconsistent state. See [the Convex Guide](https://docs.convex.dev/understanding/convex-fundamentals/functions#atomicity-and-optimistic-concurrency-control)
 * for the guarantees Convex provides your functions.
 */
export type DatabaseWriter = GenericDatabaseWriter<DataModel>;
```

---

## app/(app)/app/[orgSlug]/posts/page.tsx

```tsx
"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { useOrgBySlug } from "@/lib/useOrgBySlug";
import { publicPostUrl } from "@/lib/urls";

export default function PostsListPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const org = useOrgBySlug(orgSlug);

  const site = useQuery(
    api.sites.getSiteForOrg,
    org?._id ? { orgId: org._id } : "skip"
  );

  const posts = useQuery(
    api.posts.listPostsForSite,
    site?._id ? { siteId: site._id } : "skip"
  );

  // ── Loading states ─────────────────────────────────────────────────────────
  if (org === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading organization…</p>;
  }
  if (org === null) {
    return <p className="text-red-600">Organization not found.</p>;
  }
  if (site === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading site…</p>;
  }
  if (site === null) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Posts</h1>
        <p className="mt-4 text-gray-600">
          No site has been configured for this organization yet.
        </p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <Link
          href={`/app/${orgSlug}/posts/new`}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          New Post
        </Link>
      </div>

      {posts === undefined ? (
        <p className="text-gray-500 animate-pulse">Loading posts…</p>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-300 rounded-lg">
          <p className="text-gray-500">No posts yet.</p>
          <Link
            href={`/app/${orgSlug}/posts/new`}
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Create your first post →
          </Link>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-200">
          {posts.map((post) => (
            <div
              key={post._id}
              className="p-4 flex items-center justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{post.title}</p>
                  {post.status !== "published" && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
                      {post.status}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 font-mono">
                  /p/{post.slug}
                </p>
              </div>
              {post.status === "published" && (
                <a
                  href={publicPostUrl(site.subdomain, post.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 ml-4 text-sm text-blue-600 hover:underline"
                >
                  View&nbsp;→
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## app/(app)/app/[orgSlug]/posts/new/page.tsx

```tsx
"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useOrgBySlug } from "@/lib/useOrgBySlug";

export default function NewPostPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const router = useRouter();
  const org = useOrgBySlug(orgSlug);

  const site = useQuery(
    api.sites.getSiteForOrg,
    org?._id ? { orgId: org._id } : "skip"
  );

  const createPost = useMutation(api.posts.createPost);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (org === undefined || site === undefined) {
    return <p className="text-gray-500 animate-pulse">Loading…</p>;
  }
  if (org === null) {
    return <p className="text-red-600">Organization not found.</p>;
  }
  if (site === null) {
    return (
      <p className="text-red-600">
        No site configured for this organization.
      </p>
    );
  }

  // ── Submit handler ─────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    // Client-side validation
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle) {
      setError("Title is required");
      setIsSubmitting(false);
      return;
    }

    try {
      await createPost({
        orgId: org._id,
        siteId: site._id,
        title: trimmedTitle,
        body: trimmedBody,
      });
      router.push(`/app/${orgSlug}/posts`);
    } catch (err) {
      const message = err instanceof Error 
        ? err.message 
        : "Failed to create post";
      setError(message);
      setIsSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">New Post</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Title
          </label>
          <input
            type="text"
            id="title"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            placeholder="My first post"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label
            htmlFor="body"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Body
          </label>
          <textarea
            id="body"
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-mono"
            placeholder="Write your post content here…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-100">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !title.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? "Publishing…" : "Publish"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/app/${orgSlug}/posts`)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
```

---

## app/(public)/page.tsx

```tsx
import { resolveSite, ResolvedSite } from "@/lib/resolveSite";

/**
 * Public home page.
 *
 * Behaviour:
 *  - Apex domain (penrosepages.com, www, localhost) → no site context
 *  - Valid subdomain → resolve site and show metadata
 *  - Unknown subdomain → "Site not found" (handled by layout)
 *
 * Note: Uses cached resolveSite() which shares the query with layout.tsx
 * to avoid duplicate Convex round-trips.
 */
export default async function HomePage() {
  // Uses cached resolveSite() - shares query with layout.tsx
  const { host, subdomain, site } = await resolveSite();

  // Note: "Site not found" case is handled by layout.tsx which blocks
  // child rendering. This page only renders when site is resolved or apex.

  // ── Render: apex domain or resolved site ──────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center">
      <main className="max-w-lg w-full p-8 rounded-xl border border-gray-200 bg-white shadow-sm space-y-6">
        {site ? (
          <SiteContext site={site} />
        ) : (
          <ApexContext />
        )}
        <DebugPanel
          host={host}
          subdomain={subdomain}
          lookupAttempted={subdomain !== null}
          site={site}
        />
      </main>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ApexContext() {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Penrose Pages</h1>
      <p className="text-gray-500">
        A multi-tenant publishing platform.
      </p>
    </div>
  );
}

function SiteContext({
  site,
}: {
  site: ResolvedSite;
}) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-xs uppercase tracking-widest text-gray-400 font-medium">
        You are viewing
      </p>
      <h1 className="text-3xl font-bold tracking-tight">{site.name}</h1>
      <p className="text-gray-500 text-sm font-mono">{site.subdomain}.penrosepages.com</p>
    </div>
  );
}

function DebugPanel({
  host,
  subdomain,
  lookupAttempted,
  site,
}: {
  host: string;
  subdomain: string | null;
  lookupAttempted: boolean;
  site: ResolvedSite | null;
}) {
  // Only render in development to avoid exposing internal IDs in production
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg bg-gray-50 border border-gray-200 p-4 text-left text-xs font-mono space-y-1">
      <p className="text-gray-400 uppercase tracking-widest text-[10px] mb-2 font-sans font-semibold">
        Resolution debug
      </p>
      <Row label="host" value={host} />
      <Row label="x-site-subdomain" value={subdomain ?? "(none)"} />
      <Row label="lookup attempted" value={lookupAttempted ? "yes" : "no"} />
      <Row
        label="site found"
        value={site ? "yes" : lookupAttempted ? "no" : "n/a"}
      />
      {site && (
        <>
          <Row label="siteId" value={site._id} />
          <Row label="site name" value={site.name} />
          <Row label="orgId" value={site.orgId} />
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-gray-400 select-none">{label}: </span>
      <span className="text-gray-800">{value}</span>
    </p>
  );
}
```

---

## app/signin/page.tsx

```tsx
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
            <p className="text-red-600 mt-4" role="alert">
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

---

## lib/urls.ts

```ts
/**
 * Build the public URL for a post on a tenant site.
 *
 * @param subdomain - The site subdomain (e.g., "acme")
 * @param postSlug - The post slug (e.g., "my-first-post")
 * @returns The full URL (e.g., "https://acme.penrosepages.com/p/my-first-post")
 * @throws Error if subdomain or postSlug is empty
 *
 * Uses NEXT_PUBLIC_ROOT_DOMAIN (e.g. "penrosepages.com") in production
 * and falls back to "localhost:3000" for local development.
 *
 * Works in both server and client components because Next.js inlines
 * NEXT_PUBLIC_* vars at build time.
 */
export function publicPostUrl(subdomain: string, postSlug: string): string {
  if (!subdomain?.trim() || !postSlug?.trim()) {
    throw new Error("Subdomain and postSlug are required");
  }

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const protocol = rootDomain.startsWith("localhost") ? "http" : "https";
  
  return `${protocol}://${subdomain}.${rootDomain}/p/${postSlug}`;
}
```

---

## package.json

```json
{"name":"penrose-app","version":"0.1.0","private":true,"scripts":{"dev":"next dev","build":"next build","start":"next start","lint":"eslint","convex:dev":"convex dev"},"dependencies":{"@auth/core":"^0.37.0","@convex-dev/auth":"^0.0.90","next":"16.1.6","next-auth":"^5.0.0-beta.30","react":"19.2.3","react-dom":"19.2.3"},"devDependencies":{"@tailwindcss/postcss":"^4","@types/node":"^20","@types/react":"^19","@types/react-dom":"^19","convex":"^1.31.7","eslint":"^9","eslint-config-next":"16.1.6","tailwindcss":"^4","typescript":"^5"}}
```

---

## next.config.ts

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
```

---

## tsconfig.json

```json
{"compilerOptions":{"target":"ES2017","lib":["dom","dom.iterable","esnext"],"allowJs":true,"skipLibCheck":true,"strict":true,"noEmit":true,"esModuleInterop":true,"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"isolatedModules":true,"jsx":"react-jsx","incremental":true,"plugins":[{"name":"next"}],"paths":{"@/*":["./*"]}},"include":["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts",".next/dev/types/**/*.ts","**/*.mts"],"exclude":["node_modules"]}
```

---

## convex.json

```json
{"functions":"convex/"}
```

---

## convex/tsconfig.json

```json
{
  /* This TypeScript project config describes the environment that
   * Convex functions run in and is used to typecheck them.
   * You can modify it, but some settings are required to use Convex.
   */
  "compilerOptions": {
    /* These settings are not required by Convex and can be modified. */
    "allowJs": true,
    "strict": true,
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,

    /* These compiler options are required by Convex */
    "target": "ESNext",
    "lib": ["ES2021", "dom"],
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["./**/*"],
  "exclude": ["./_generated"]
}
```

---

## eslint.config.mjs

```js
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

---

## scripts/generate-auth-keys.mjs

```js
#!/usr/bin/env node
/**
 * Generate JWT_PRIVATE_KEY and JWKS for Convex Auth.
 * Run: node scripts/generate-auth-keys.mjs
 * Then set the output in Convex: npx convex env set JWT_PRIVATE_KEY "..." JWKS "..."
 */
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

console.log("\nAdd these to Convex (npx convex env set):\n");
console.log(`JWT_PRIVATE_KEY="${privateKey.trimEnd().replace(/\n/g, " ")}"`);
console.log(`JWKS='${jwks}'`);
console.log("\nOr run: npx convex env set JWT_PRIVATE_KEY \"<paste key>\" JWKS '<paste jwks>'");
```

---
