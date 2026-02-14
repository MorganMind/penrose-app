"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";

/**
 * Fixed bottom-right button to restart onboarding for testing.
 * Visible on all app pages.
 */
export function RestartOnboardingButton() {
  const router = useRouter();
  const userInfo = useQuery(api.users.whoami);
  const resetOnboarding = useMutation(api.users.resetOnboarding);

  const handleRestart = async () => {
    await resetOnboarding();
    router.push("/start");
  };

  if (!userInfo) return null;
  const isComplete = (userInfo.onboardingStatus ?? "not_started") === "complete";
  if (!isComplete) return null;

  return (
    <button
      type="button"
      onClick={handleRestart}
      className="fixed bottom-6 right-6 z-50 px-4 py-2.5 bg-gray-800 text-white rounded-md text-sm font-medium hover:bg-gray-700 shadow-lg transition-colors border border-gray-600"
    >
      Restart onboarding
    </button>
  );
}
