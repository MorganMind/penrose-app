# Convex Auth + Next.js Setup Guide

For future reference when setting up Convex Auth with Next.js.

---

## What Was Wrong (and How We Fixed It)

### 1. Single auth file conflating two configs

**Problem:** One file (`auth.config.ts`) tried to serve both Convex's platform AuthConfig and Convex Auth's provider config. Convex expects `auth.config.ts` to export `{ providers: [{ domain, applicationID }] }` for OIDC trust. Convex Auth needs a separate file with `convexAuth({ providers: [Google] })`.

**Fix:** Split into two files:
- `convex/auth.config.ts` – Convex platform config
- `convex/auth.ts` – Convex Auth config

---

### 2. Wrong provider format

**Problem:** Code passed `Google({ clientId: "...", clientSecret: "..." })` – instantiating the provider with env vars read at module load. Convex Auth validates the config at push time; env vars may not be available then, so validation failed with "missing field `providers`".

**Fix:** Pass the provider reference: `[Google]`. Convex Auth reads `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` from Convex env vars at runtime.

---

### 3. Missing `isAuthenticated` export

**Problem:** Convex Auth 0.0.76+ requires `isAuthenticated` to be exported from `convexAuth()`. The Next.js middleware calls it for auth checks. Without it: "could not find api.auth.isAuthenticated".

**Fix:** Export it: `export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({...})`.

---

### 4. Missing JWT keys

**Problem:** Convex Auth needs `JWT_PRIVATE_KEY` and `JWKS` for signing and verifying JWTs. The `/.well-known/jwks.json` endpoint failed with "Missing environment variable `JWKS`", causing auth discovery to fail and tokens to be rejected.

**Fix:** Generate an RSA key pair with jose, set both vars in Convex:
```bash
echo '<private-key>' | npx convex env set JWT_PRIVATE_KEY
echo '<jwks-json>' | npx convex env set JWKS
```

---

### 5. Client and middleware both handling OAuth code

**Problem:** The signin page called `signIn("google", { code })` when there was a code in the URL. The middleware also exchanges the code. Both tried to handle it; the code is single-use, so one of them failed and the token never reached the client correctly.

**Fix:** Let the middleware handle it. Remove client-side `signIn` with code. The middleware exchanges the code, sets cookies, and redirects to `/signin` (without code). The signin page only redirects to `/app` when `useAuthToken()` returns a token (from cookies/serverState).

---

### 6. Cookies not persisting

**Problem:** Middleware used default cookie config (session cookies). Tokens didn't persist across browser restarts.

**Fix:** Add `cookieConfig: { maxAge: 60 * 60 * 24 * 7 }` (7 days) to the middleware options.

---

### 7. Token present but user null (stale token)

**Problem:** After fixing auth, users still had old tokens in localStorage/cookies from before the fix. Convex rejected them (wrong signing key or invalid format). `useAuthToken()` showed a token, but `whoami` returned null.

**Fix:** Sign out (clear cookies + localStorage) and sign in again to get a fresh token. Avoid auto-redirect loops that clear localStorage but leave cookies—cookies must be cleared too (e.g. via signOut).

---

## Setup Checklist (for next time)

1. **Two auth files**
   - `convex/auth.config.ts` – Convex platform: `{ providers: [{ domain, applicationID: "convex" }] }`
   - `convex/auth.ts` – Convex Auth: `convexAuth({ providers: [Google] })`

2. **Provider format** – Pass `[Google]`, not `[Google({ clientId, clientSecret })]`. Convex Auth reads `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` from env.

3. **Exports** – Include `auth, signIn, signOut, store, isAuthenticated` from `convexAuth()`.

4. **JWT keys** – Generate with jose, set `JWT_PRIVATE_KEY` and `JWKS` in Convex via `npx convex env set` (use stdin for multi-line values). See `scripts/generate-auth-keys.mjs`.

5. **OAuth flow** – Middleware handles the code. The signin page does not call `signIn("google", { code })`.

6. **Middleware** – Add `cookieConfig: { maxAge: 60 * 60 * 24 * 7 }` so cookies persist.

7. **HTTP** – `convex/http.ts` imports from `./auth` and calls `auth.addHttpRoutes(http)`.

8. **Convex env vars** – `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `JWT_PRIVATE_KEY`, `JWKS`. Optionally `CONVEX_SITE_URL`, `SITE_URL`, `NEXT_PUBLIC_APP_URL`.
