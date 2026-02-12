"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";

export function OrgSwitcher() {
  const params = useParams();
  const router = useRouter();
  const orgSlug = params.orgSlug as string | undefined;
  const user = useQuery(api.users.whoami);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (user === undefined) {
    return (
      <span className="text-sm text-gray-400">Loading…</span>
    );
  }

  if (user === null) {
    return null;
  }

  if (user.orgs.length === 0) {
    return (
      <Link
        href="/app/onboarding"
        className="text-sm text-gray-600 hover:underline"
      >
        Create organization
      </Link>
    );
  }

  const currentOrg = user.orgs.find((o) => o.slug === orgSlug);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-sm text-gray-600 hover:text-gray-900 hover:underline focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1 rounded"
      >
        {orgSlug && currentOrg ? (
          <>org: {currentOrg.name ?? orgSlug}</>
        ) : (
          <>Select an organization</>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1 w-56 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5 z-50">
          {user.orgs.map((org) => (
            <button
              key={org.orgId}
              type="button"
              onClick={() => {
                router.push(`/app/${org.slug}`);
                setIsOpen(false);
              }}
              className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                org.slug === orgSlug ? "text-gray-900 font-medium" : "text-gray-600"
              }`}
            >
              {org.name ?? org.slug}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
