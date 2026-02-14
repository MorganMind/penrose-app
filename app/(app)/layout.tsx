"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { UserMenu } from "./components/UserMenu";
import { OrgSwitcher } from "./components/OrgSwitcher";
import { OnboardingRecovery } from "./components/OnboardingRecovery";
import { RestartOnboardingButton } from "./components/RestartOnboardingButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const userInfo = useQuery(api.users.whoami);
  const orgSlug = params.orgSlug as string | undefined;

  const onboardingStatus = userInfo?.onboardingStatus ?? "not_started";

  useEffect(() => {
    if (!userInfo) return;
    if (onboardingStatus === "not_started") {
      router.replace("/start");
    }
  }, [userInfo, onboardingStatus, router]);

  if (userInfo && onboardingStatus === "not_started") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500 animate-pulse">Redirecting…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <OnboardingRecovery />
      <RestartOnboardingButton />
      <header className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/app" className="font-semibold">
              Penrose
            </Link>
            <OrgSwitcher />
          </div>
          <nav className="flex gap-4 items-center">
            {orgSlug ? (
              <>
                <Link
                  href={`/app/${orgSlug}`}
                  className="text-sm hover:underline"
                >
                  Dashboard
                </Link>
                <Link
                  href={`/app/${orgSlug}/posts`}
                  className="text-sm hover:underline"
                >
                  Posts
                </Link>
              </>
            ) : null}
            <div className="ml-2 pl-4 border-l border-gray-200">
              <UserMenu />
            </div>
          </nav>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
