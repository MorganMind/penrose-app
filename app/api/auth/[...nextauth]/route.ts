/**
 * ⚠️ AUTH FILE - DO NOT MODIFY WITHOUT ASKING USER FIRST.
 */
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
