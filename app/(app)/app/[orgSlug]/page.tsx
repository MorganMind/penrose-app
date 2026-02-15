"use client";

import { useParams } from "next/navigation";
import { useOrgBySlug } from "@/lib/useOrgBySlug";
import { RestartOnboardingButton } from "@/app/(app)/components/RestartOnboardingButton";

export default function OrgDashboardPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const org = useOrgBySlug(orgSlug);

  if (org === undefined) {
    return <p className="text-gray-500">Loading organization…</p>;
  }

  if (org === null) {
    return <p className="text-gray-600">Org not found</p>;
  }

  return (
    <div>
      <RestartOnboardingButton />
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-gray-600">Organization: {org.name}</p>
      <p className="mt-1 text-sm text-gray-400">ID: {org._id}</p>
    </div>
  );
}
