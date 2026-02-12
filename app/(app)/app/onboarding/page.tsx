"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";

export default function OnboardingPage() {
  const createOrg = useMutation(api.orgs.create);
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      // Auto-generate name from slug for simplicity, or we could ask for it too
      const name = slug.charAt(0).toUpperCase() + slug.slice(1);
      
      await createOrg({ name, slug });
      router.push(`/app/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-sm border border-gray-200">
        <h1 className="text-2xl font-bold mb-2">Welcome to Penrose</h1>
        <p className="text-gray-500 mb-6">Choose a handle to get started.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
              Handle
            </label>
            <div className="flex rounded-md shadow-sm">
              <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm">
                penrose.com/
              </span>
              <input
                type="text"
                id="slug"
                required
                pattern="[a-z0-9-]+"
                className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-r-md border border-gray-300 focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                placeholder="username"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          {error && (
            <p className="text-sm text-gray-600 bg-gray-100 p-2 rounded border border-gray-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !slug}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Creating..." : "Get Started"}
          </button>
        </form>
      </div>
    </div>
  );
}
