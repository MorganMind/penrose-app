"use client";

import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { CleanPaste } from "./cleanPaste";
import { GhostText, type GhostTextOptions } from "./ghostText";
import { InlineReplacement, type InlineReplacementOptions } from "./inlineReplacement";
import { DiffDecoration } from "./diffDecoration";

export type { GhostTextOptions, SuggestionContext } from "./ghostText";
export type {
  InlineReplacementOptions,
  ReplacementContext,
  ReplacementSuggestion,
} from "./inlineReplacement";

export interface PenroseExtensionOptions {
  placeholder?: string;
  ghostText?: GhostTextOptions;
  inlineReplacement?: InlineReplacementOptions;
}

/**
 * Penrose baseline editor extensions.
 * Minimal but serious set for long-form writing and Markdown publishing.
 */
export function createPenroseExtensions(
  options: PenroseExtensionOptions | string = {}
) {
  const opts =
    typeof options === "string" ? { placeholder: options } : options;
  const { placeholder, ghostText, inlineReplacement } = opts;

  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "text-gray-700 underline hover:text-gray-900" },
    }),
    Placeholder.configure({ placeholder: placeholder ?? "Start writing…" }),
    Markdown.configure({
      markedOptions: { gfm: true, breaks: true },
    }),
    CleanPaste,
    GhostText.configure(ghostText ?? {}),
    InlineReplacement.configure(inlineReplacement ?? {}),
    DiffDecoration,
  ];
}
