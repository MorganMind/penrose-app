"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";

export default function AppLandingPage() {
  const token = useAuthToken();
  const userInfo = useQuery(api.users.whoami);
  const { signOut } = useAuthActions();
  const router = useRouter();

  // Debug logging
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("AppLandingPage - token:", token ? "present" : "missing");
      console.log("AppLandingPage - userInfo:", userInfo);
    }
  }, [token, userInfo]);

  useEffect(() => {
    if (userInfo && userInfo.orgs.length === 0) {
      router.push("/app/onboarding");
    }
  }, [userInfo, router]);

  if (userInfo === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-gray-500 animate-pulse">Loading...</div>
      </div>
    );
  }

  if (userInfo === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-500">Not authenticated</p>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Welcome back, {userInfo.name}</h1>
      <p className="mt-2 text-gray-600">
        Select an organization from the top bar to manage your content.
      </p>
    </div>
  );
}
