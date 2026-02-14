"use client";

import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { EditorialMode } from "@/convex/lib/prompts";
import {
  PanelType,
  REACTION_PANELS,
  getNextPanel,
} from "@/convex/lib/reactionPanels";

type ReactionPanelProps = {
  orgId: Id<"orgs">;
  postId: Id<"posts">;
  mode: EditorialMode;
  provider: string;
  model: string;
  promptVersion: string;
  nudgeDirection?: string;
  suggestionIndex: number;
};

export function ReactionPanel({
  orgId,
  postId,
  mode,
  provider,
  model,
  promptVersion,
  nudgeDirection,
  suggestionIndex,
}: ReactionPanelProps) {
  const reactionCount = useQuery(api.voiceReactions.getReactionCount, { orgId });
  const submitReaction = useMutation(api.voiceReactions.submitReaction);

  const [answered, setAnswered] = useState<PanelType[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset when a new suggestion arrives
  useEffect(() => {
    setAnswered([]);
  }, [suggestionIndex]);

  const handleReact = useCallback(
    async (panelType: PanelType, reaction: string) => {
      setIsSubmitting(true);
      try {
        await submitReaction({
          orgId,
          postId,
          editorialMode: mode,
          panelType,
          reaction,
          provider,
          model,
          promptVersion,
          nudgeDirection,
        });
        setAnswered((prev) => [...prev, panelType]);
      } finally {
        setIsSubmitting(false);
      }
    },
    [orgId, postId, mode, provider, model, promptVersion, nudgeDirection, submitReaction]
  );

  if (reactionCount === undefined) return null;

  const currentPanel = getNextPanel(reactionCount, answered, suggestionIndex);
  if (!currentPanel) return null;

  const config = REACTION_PANELS[currentPanel];

  return (
    <div className="flex items-center gap-3 py-2 px-1">
      <span className="text-xs text-gray-500 shrink-0">{config.prompt}</span>
      <div className="flex gap-1.5 flex-wrap">
        {config.options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => handleReact(currentPanel, opt.key)}
            disabled={isSubmitting}
            className="px-2.5 py-1 text-xs rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300 disabled:opacity-50 transition-colors"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
