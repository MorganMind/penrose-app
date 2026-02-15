export {
  PenroseEditor,
  type PenroseEditorRef,
  type PenroseEditorProps,
} from "./PenroseEditor";
export { useAutosave, type SaveStatus, type SavePayload } from "./useAutosave";
export { SaveIndicator } from "./SaveIndicator";
export { useRealtimeSuggestions } from "./useRealtimeSuggestions";
export { getMockSuggestion } from "./mockSuggestionProvider";
export { getMockReplacement } from "./mockReplacementProvider";
export type { GhostTextOptions, SuggestionContext } from "./extensions";
export type {
  InlineReplacementOptions,
  ReplacementContext,
  ReplacementSuggestion,
} from "./extensions";
