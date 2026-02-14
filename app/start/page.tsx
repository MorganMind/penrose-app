"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useSpeechRecognition } from "@/lib/useSpeechRecognition";
import { NudgeDirection } from "@/convex/lib/nudges";

const ONBOARDING_DRAFT_KEY = "penrose-onboarding-draft";
const MIN_CHARS_FOR_SHARPEN = 20;

type SuggestionState = {
  originalText: string;
  suggestedText: string;
  provider: string;
  model: string;
  promptVersion: string;
  nudgeDirection?: string;
};

function getRandomNudge(): NudgeDirection {
  const bias = ["sharper", "more_minimal", "softer"] as NudgeDirection[];
  return bias[Math.floor(Math.random() * bias.length)];
}

export default function StartPage() {
  const router = useRouter();
  const userInfo = useQuery(api.users.whoami);
  const setOnboardingInProgress = useMutation(api.users.setOnboardingInProgress);
  const createPostFromOnboarding = useAction(api.onboarding.createPostFromOnboarding);
  const refineLineWithText = useAction(api.ai.refineLineWithText);

  const [text, setText] = useState("");
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");
  const hasMarkedInProgress = useRef(false);
  const navigatingToPostRef = useRef(false);

  // Restore draft from localStorage (orphaned recovery)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (stored) setText(stored);
  }, []);

  // Persist draft when in_progress
  useEffect(() => {
    if (typeof window === "undefined" || !userInfo) return;
    const status = userInfo.onboardingStatus ?? "not_started";
    if (status === "in_progress" && text) {
      localStorage.setItem(ONBOARDING_DRAFT_KEY, text);
    } else if (status === "complete") {
      localStorage.removeItem(ONBOARDING_DRAFT_KEY);
    }
  }, [userInfo, text]);

  const markInProgress = useCallback(async () => {
    if (hasMarkedInProgress.current) return;
    const status = userInfo?.onboardingStatus ?? "not_started";
    if (status !== "not_started") return;
    hasMarkedInProgress.current = true;
    try {
      await setOnboardingInProgress();
    } catch {
      hasMarkedInProgress.current = false;
    }
  }, [userInfo?.onboardingStatus, setOnboardingInProgress]);

  const transcriptBaseRef = useRef("");
  const handleTranscript = useCallback(
    (newText: string, isFinal: boolean) => {
      if (isFinal) {
        transcriptBaseRef.current =
          transcriptBaseRef.current + (transcriptBaseRef.current ? " " : "") + newText;
        setText(transcriptBaseRef.current);
      } else {
        setText(
          transcriptBaseRef.current + (transcriptBaseRef.current ? " " : "") + newText
        );
      }
    },
    []
  );

  const { start: startMic, stop: stopMic, status: micStatus } =
    useSpeechRecognition({
      onTranscript: handleTranscript,
      onActivation: markInProgress,
    });

  const handleMicClick = useCallback(() => {
    markInProgress();
    if (micStatus === "listening") {
      stopMic();
    } else {
      startMic();
    }
  }, [markInProgress, micStatus, startMic, stopMic]);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      markInProgress();
      setText(e.target.value);
    },
    [markInProgress]
  );

  const handleSharpen = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_CHARS_FOR_SHARPEN) return;
    setIsRefining(true);
    setError("");
    try {
      const result = await refineLineWithText({ text: trimmed });
      setSuggestion({
        originalText: result.originalText,
        suggestedText: result.suggestedText,
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refinement failed");
    } finally {
      setIsRefining(false);
    }
  }, [text, refineLineWithText]);

  const handleTryAgain = useCallback(async () => {
    if (!suggestion) return;
    setIsRefining(true);
    setError("");
    const nudge = getRandomNudge();
    try {
      const result = await refineLineWithText({
        text: suggestion.originalText,
        nudgeDirection: nudge,
      });
      setSuggestion({
        ...result,
        nudgeDirection: nudge,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again failed");
    } finally {
      setIsRefining(false);
    }
  }, [suggestion, refineLineWithText]);

  const handleApply = useCallback(async () => {
    if (!suggestion) return;
    setIsApplying(true);
    setError("");
    try {
      const { orgSlug, postId } = await createPostFromOnboarding({
        body: suggestion.suggestedText,
      });
      localStorage.removeItem(ONBOARDING_DRAFT_KEY);
      navigatingToPostRef.current = true;
      router.push(`/app/${orgSlug}/posts/${postId}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post");
      setIsApplying(false);
    }
  }, [suggestion, createPostFromOnboarding, router]);

  // Redirect if already complete (e.g. user manually navigated to /start)
  // Skip when we're navigating to post edit after Apply
  useEffect(() => {
    if (!userInfo || navigatingToPostRef.current) return;
    const status = userInfo.onboardingStatus ?? "not_started";
    if (status === "complete") {
      router.push("/app");
    }
  }, [userInfo, router]);

  if (userInfo === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500 animate-pulse">Loading…</div>
      </div>
    );
  }

  if (userInfo === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-600">Please sign in to continue.</div>
      </div>
    );
  }

  const status = userInfo.onboardingStatus ?? "not_started";
  if (status === "complete") {
    return null;
  }

  const canSharpen = text.trim().length >= MIN_CHARS_FOR_SHARPEN && !suggestion && !isRefining;
  const showEditor = !suggestion;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Headline */}
        <div
          className="text-center mb-8"
          style={{ marginTop: "min(35vh, 200px)" }}
        >
          <h1 className="text-3xl md:text-4xl font-semibold text-gray-900 tracking-tight">
            What are you trying to say?
          </h1>
          <p className="mt-3 text-gray-500 text-base">
            Write how you'd say it out loud.
          </p>
        </div>

        {/* Main input or suggestion view */}
        {showEditor ? (
          <div className="space-y-4">
            <div className="relative">
              <textarea
                id="onboarding-textarea"
                rows={14}
                className="w-full px-4 py-4 border border-gray-200 rounded-lg shadow-sm focus:ring-1 focus:ring-gray-400 focus:border-gray-400 resize-y min-h-[200px] text-gray-900 font-mono text-sm leading-relaxed"
                placeholder="Don't write well. Write honestly.

Paste anything — notes, drafts, emails, scattered thoughts."
                value={text}
                onChange={handleTextChange}
                disabled={isRefining}
              />
              <button
                type="button"
                onClick={handleMicClick}
                disabled={micStatus === "unsupported"}
                title={micStatus === "listening" ? "Stop" : "Start voice input"}
                className="absolute bottom-3 left-3 p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700 hover:border-gray-300 disabled:opacity-50 transition-colors border border-transparent"
                aria-label={micStatus === "listening" ? "Stop listening" : "Start voice input"}
              >
                {micStatus === "listening" ? (
                  <span className="text-lg">⏹</span>
                ) : (
                  <span className="text-lg">🎙</span>
                )}
              </button>
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleSharpen}
                disabled={!canSharpen}
                className="px-6 py-3 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isRefining ? "Sharpening…" : "Sharpen it"}
              </button>
            </div>
          </div>
        ) : suggestion ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 divide-x divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
              <div className="p-4 bg-gray-50/30">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                  Original
                </p>
                <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-700">
                  {suggestion.originalText}
                </div>
              </div>
              <div className="p-4 bg-gray-50/50">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                  Sharpened
                </p>
                <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-gray-800">
                  {suggestion.suggestedText}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleApply}
                disabled={isRefining || isApplying}
                className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {isApplying ? "Creating post…" : "Apply"}
              </button>
              <button
                type="button"
                onClick={handleTryAgain}
                disabled={isRefining}
                className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {isRefining ? "Trying…" : "Try again"}
              </button>
            </div>
          </div>
        ) : null}

        {error && (
          <p className="mt-4 text-sm text-gray-600 bg-gray-100 p-3 rounded border border-gray-200">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
