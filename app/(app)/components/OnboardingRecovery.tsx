"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export function OnboardingRecovery() {
  const userInfo = useQuery(api.users.whoami);
  const onboardingStatus = userInfo?.onboardingStatus ?? "not_started";

  if (onboardingStatus !== "in_progress") return null;

  return (
    <>
      {/* Centered banner: Get started */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
        <Link
          href="/start"
          className="inline-flex px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 transition-colors border border-gray-200 shadow-sm"
        >
          Get started
        </Link>
      </div>

      {/* Floating bottom-right: Continue sharpening */}
      <Link
        href="/start"
        className="fixed bottom-6 right-6 z-50 px-4 py-2.5 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 shadow-lg transition-colors"
      >
        Continue sharpening
      </Link>
    </>
  );
}
