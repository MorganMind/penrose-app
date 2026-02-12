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
