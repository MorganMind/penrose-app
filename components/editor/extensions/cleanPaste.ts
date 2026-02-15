"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Clean paste: strip HTML formatting by default.
 * Hold Shift while pasting to preserve formatting.
 */
export const CleanPaste = Extension.create({
  name: "cleanPaste",

  addProseMirrorPlugins() {

    return [
      new Plugin({
        key: new PluginKey("cleanPaste"),
        props: {
          handlePaste(view, event) {
            const html = event.clipboardData?.getData("text/html");
            const text = event.clipboardData?.getData("text/plain") ?? "";

            // Shift+paste: allow rich paste (default ProseMirror behavior)
            if ("shiftKey" in event && event.shiftKey) return false;

            // No HTML or empty: let default handler run
            if (!html?.trim() || !text?.trim()) return false;

            // HTML present without Shift: paste as plain text
            event.preventDefault();
            const { state, dispatch } = view;
            const { from } = state.selection;
            const tr = state.tr.insertText(text, from);
            dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
