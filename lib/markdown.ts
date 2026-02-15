/**
 * Markdown utilities for non-editor contexts (e.g. public post rendering).
 * The Tiptap editor uses @tiptap/markdown for parse/serialize during editing.
 */

import { marked } from "marked";

/**
 * Convert markdown to HTML for display.
 * Used on the public post page where there is no Tiptap editor.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown?.trim()) return "";
  return marked.parse(markdown, {
    gfm: true,
    breaks: true,
  }) as string;
}
