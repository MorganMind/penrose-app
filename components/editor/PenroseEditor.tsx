"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import {
  createPenroseExtensions,
  type GhostTextOptions,
  type InlineReplacementOptions,
} from "./extensions";

export type PenroseEditorRef = {
  getMarkdown: () => string;
  setContent: (markdown: string) => void;
  focus: () => void;
};

export type PenroseEditorProps = {
  initialMarkdown?: string;
  onChangeMarkdown?: (markdown: string) => void;
  readonly?: boolean;
  placeholder?: string;
  className?: string;
  /** Real-time ghost text suggestion configuration */
  ghostText?: GhostTextOptions;
  /** Inline word replacement suggestion configuration */
  inlineReplacement?: InlineReplacementOptions;
};

export const PenroseEditor = forwardRef<PenroseEditorRef, PenroseEditorProps>(
  function PenroseEditor(
    {
      initialMarkdown = "",
      onChangeMarkdown,
      readonly = false,
      placeholder,
      className,
      ghostText,
      inlineReplacement,
    },
    ref
  ) {
    const onChangeRef = useRef(onChangeMarkdown);
    onChangeRef.current = onChangeMarkdown;

    const editor = useEditor({
      immediatelyRender: false,
      extensions: createPenroseExtensions({
        placeholder,
        ghostText: ghostText ?? { enabled: false },
        inlineReplacement: inlineReplacement ?? { enabled: false },
      }),
      content: initialMarkdown,
      contentType: "markdown",
      editable: !readonly,
      editorProps: {
        attributes: {
          class:
            "prose-editor min-h-[200px] outline-none focus:outline-none",
        },
      },
      onUpdate: ({ editor }) => {
        if (editor.isDestroyed) return;
        const md = editor.getMarkdown?.();
        if (typeof md === "string") {
          onChangeRef.current?.(md);
        }
      },
    });

    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!readonly);
    }, [editor, readonly]);

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => {
          if (!editor) return "";
          return editor.getMarkdown?.() ?? "";
        },
        setContent: (markdown: string) => {
          if (!editor) return;
          editor.commands.setContent(markdown ?? "", {
            contentType: "markdown",
            emitUpdate: false,
          });
        },
        focus: () => editor?.commands.focus(),
      }),
      [editor]
    );

    if (!editor) return null;

    return (
      <div className={className}>
        <EditorContent editor={editor} />
      </div>
    );
  }
);
