"use client";

import { useState, useRef } from "react";
import { PenroseEditor, type PenroseEditorRef } from "@/components/editor/PenroseEditor";

const SAMPLE_MARKDOWN = `# Heading 1

This is a **bold** and *italic* paragraph with \`inline code\`.

## Heading 2

- Bullet one
- Bullet two
- Bullet three

### Heading 3

1. First
2. Second
3. Third

> A blockquote for emphasis.

---

[Link example](https://example.com)
`;

const LARGE_DOC = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`).join("\n\n");

export default function EditorHarnessPage() {
  const [markdown, setMarkdown] = useState(SAMPLE_MARKDOWN);
  const [roundTripOk, setRoundTripOk] = useState<boolean | null>(null);
  const editorRef = useRef<PenroseEditorRef | null>(null);

  const handleChange = (md: string) => {
    setMarkdown(md);
    setRoundTripOk(null);
  };

  const testRoundTrip = () => {
    const current = editorRef.current?.getMarkdown() ?? "";
    setMarkdown(current);
    // Simple sanity: re-set and compare (editor normalizes)
    editorRef.current?.setContent(current);
    const after = editorRef.current?.getMarkdown() ?? "";
    setRoundTripOk(current === after);
  };

  const loadLarge = () => {
    setMarkdown(LARGE_DOC);
    editorRef.current?.setContent(LARGE_DOC);
    setRoundTripOk(null);
  };

  const loadSample = () => {
    setMarkdown(SAMPLE_MARKDOWN);
    editorRef.current?.setContent(SAMPLE_MARKDOWN);
    setRoundTripOk(null);
  };

  return (
    <div className="max-w-[680px] mx-auto py-8 space-y-6">
      <h1 className="text-2xl font-semibold">Editor Dev Harness</h1>
      <p className="text-sm text-gray-500">
        Test large document performance, markdown paste, undo/redo, and serialization stability.
      </p>

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={loadSample}
          className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded text-sm hover:bg-gray-300"
        >
          Load sample
        </button>
        <button
          type="button"
          onClick={loadLarge}
          className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded text-sm hover:bg-gray-300"
        >
          Load large doc (~50 paragraphs)
        </button>
        <button
          type="button"
          onClick={testRoundTrip}
          className="px-3 py-1.5 bg-gray-800 text-white rounded text-sm hover:bg-gray-900"
        >
          Test round-trip
        </button>
      </div>

      {roundTripOk !== null && (
        <p className={`text-sm ${roundTripOk ? "text-gray-600" : "text-gray-600"}`}>
          Round-trip: {roundTripOk ? "OK" : "Mismatch"}
        </p>
      )}

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <PenroseEditor
          ref={editorRef}
          initialMarkdown={markdown}
          onChangeMarkdown={handleChange}
          placeholder="Start writing…"
        />
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
          Raw markdown output
        </summary>
        <pre className="mt-2 p-4 bg-gray-50 rounded overflow-auto max-h-48 text-xs font-mono whitespace-pre-wrap break-words">
          {markdown || "(empty)"}
        </pre>
      </details>
    </div>
  );
}
