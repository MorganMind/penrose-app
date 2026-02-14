# Multi-Tenant Blogging CMS

A multi-tenant blogging CMS built with Next.js (App Router, TypeScript), Convex, and Auth.js.

> **Note**: See [CODE_REVIEW.md](./CODE_REVIEW.md) for code review and evaluation guidelines.

> **⚠️ AUTH: Do not modify auth-related code without asking first.** Auth is fragile. See [.cursorrules](./.cursorrules). Auth files: `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts`, `middleware.ts`, `app/signin/`, `app/api/auth/`, `app/layout.tsx`, `app/ConvexClientProvider.tsx`.

## Prerequisites

- Node.js 18+ 
- npm or yarn
- A Convex account (sign up at [convex.dev](https://convex.dev))

## Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up Convex:**
   ```bash
   npx convex dev
   ```
   This will:
   - Create a new Convex project (if you don't have one)
   - Generate a `.env.local` file with your Convex deployment URL
   - Start the Convex development server

3. **Configure environment variables:**
   ```bash
   cp .env.local.example .env.local
   ```
   Then edit `.env.local` and add:
   - `AUTH_SECRET`: Generate with `openssl rand -base64 32`
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Get from [Google Cloud Console](https://console.cloud.google.com/)

4. **AI / Editorial features (Phase 12 — optional):**
   Set Convex env vars for editorial refinement and voice validation:
   ```bash
   npx convex env set OPENAI_API_KEY sk-...
   npx convex env set AI_PROVIDER openai    # optional, default: openai
   npx convex env set AI_MODEL gpt-4o-mini  # optional, default: gpt-4o-mini
   ```
   See `env.example` for the full list.

5. **Start the Next.js development server:**
   ```bash
   npm run dev
   ```

6. **Open your browser:**
   - Home page (no auth required): [http://localhost:3000](http://localhost:3000)
   - Protected page (auth required): [http://localhost:3000/app](http://localhost:3000/app)

## Development

- **Next.js dev server:** `npm run dev`
- **Convex dev server:** `npx convex dev` (run in a separate terminal)

The Convex dev server will:
- Watch for changes in `convex/` directory
- Generate TypeScript types in `convex/_generated/`
- Sync your schema and functions to your Convex deployment

## Project Structure

```
app/
  api/auth/          # Auth.js API routes
  app/                # Protected routes (requires authentication)
  page.tsx            # Public home page
convex/
  auth.ts             # Convex auth configuration
  schema.ts           # Database schema (includes auth tables)
```

## Phase 1 Status

✅ Next.js with TypeScript and Tailwind configured
✅ Convex integrated with codegen working
✅ Auth.js middleware enabled
✅ Public home page at `/`
✅ Protected page at `/app` (redirects to sign-in when logged out)
