"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type VoiceScratchpadProps = {
  orgId: Id<"orgs">;
};

export function VoiceScratchpad({ orgId }: VoiceScratchpadProps) {
  const pref = useQuery(api.voicePreferences.getForOrg, { orgId });
  const saveScratchpad = useMutation(api.voicePreferences.saveScratchpad);
  const validateScratchpad = useAction(api.voiceActions.validateScratchpad);

  const [content, setContent] = useState("");
  const [serverContent, setServerContent] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState("");

  const isDirty = content !== serverContent;

  useEffect(() => {
    if (!pref) return;
    if (serverContent === "" && pref.content) {
      setContent(pref.content);
      setServerContent(pref.content);
      return;
    }
    if (!isDirty && pref.content !== serverContent) {
      setContent(pref.content);
      setServerContent(pref.content);
    }
  }, [pref, serverContent, isDirty]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError("");
    try {
      await saveScratchpad({ orgId, content: content.trim() });
      setServerContent(content.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [orgId, content, saveScratchpad]);

  const handleValidate = useCallback(async () => {
    if (isDirty) {
      setError("Save your changes before validating.");
      return;
    }
    setIsValidating(true);
    setError("");
    try {
      await validateScratchpad({ orgId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setIsValidating(false);
    }
  }, [orgId, isDirty, validateScratchpad]);

  const validation = pref?.validationResult;
  const hasIssues =
    validation &&
    (validation.redundancies.length > 0 ||
      validation.contradictions.length > 0 ||
      validation.suggestions.length > 0);

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
      >
        <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
          ▸
        </span>
        Voice Preferences
        {pref?.content && (
          <span className="text-xs font-normal text-gray-400 ml-1">
            ({pref.content.length} chars)
          </span>
        )}
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500">
            Describe your writing style preferences. These guide editorial
            suggestions across all posts.
          </p>

          <textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="e.g., I prefer short sentences. I never use semicolons. I write casually with contractions. Avoid corporate jargon…"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md font-mono focus:ring-gray-500 focus:border-gray-500"
          />

          {error && (
            <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className="px-3 py-1.5 bg-gray-800 text-white text-xs rounded hover:bg-gray-900 disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={handleValidate}
              disabled={isValidating || isDirty || !content.trim()}
              className="px-3 py-1.5 bg-gray-200 text-gray-800 border border-gray-300 text-xs rounded hover:bg-gray-300 disabled:opacity-50"
            >
              {isValidating ? "Checking…" : "Check for issues"}
            </button>
          </div>

          {hasIssues && validation && (
            <div className="space-y-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs">
              {validation.contradictions.length > 0 && (
                <div>
                  <p className="font-semibold text-red-600 mb-1">
                    Contradictions
                  </p>
                  {validation.contradictions.map((c, i) => (
                    <p key={i} className="text-red-600 ml-2">
                      • {c}
                    </p>
                  ))}
                </div>
              )}
              {validation.redundancies.length > 0 && (
                <div>
                  <p className="font-semibold text-yellow-600 mb-1">
                    Redundancies
                  </p>
                  {validation.redundancies.map((r, i) => (
                    <p key={i} className="text-yellow-600 ml-2">
                      • {r}
                    </p>
                  ))}
                </div>
              )}
              {validation.suggestions.length > 0 && (
                <div>
                  <p className="font-semibold text-gray-600 mb-1">
                    Suggestions
                  </p>
                  {validation.suggestions.map((s, i) => (
                    <p key={i} className="text-gray-600 ml-2">
                      • {s}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {validation && !hasIssues && (
            <p className="text-xs text-green-600">
              ✓ No contradictions or redundancy detected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
