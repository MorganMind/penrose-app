/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as ai from "../ai.js";
import type * as ai_realtimeSuggestions from "../ai/realtimeSuggestions.js";
import type * as ai_realtimeSuggestionsMetrics from "../ai/realtimeSuggestionsMetrics.js";
import type * as auth from "../auth.js";
import type * as editorialRuns from "../editorialRuns.js";
import type * as http from "../http.js";
import type * as lib_aiClient from "../lib/aiClient.js";
import type * as lib_calibrationDataset from "../lib/calibrationDataset.js";
import type * as lib_candidateSelection from "../lib/candidateSelection.js";
import type * as lib_candidateVariations from "../lib/candidateVariations.js";
import type * as lib_embeddings from "../lib/embeddings.js";
import type * as lib_nudges from "../lib/nudges.js";
import type * as lib_preferenceSignals from "../lib/preferenceSignals.js";
import type * as lib_profileConfidence from "../lib/profileConfidence.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_reactionPanels from "../lib/reactionPanels.js";
import type * as lib_realtimeSuggestions from "../lib/realtimeSuggestions.js";
import type * as lib_slugify from "../lib/slugify.js";
import type * as lib_voiceCorrection from "../lib/voiceCorrection.js";
import type * as lib_voiceEnforcement from "../lib/voiceEnforcement.js";
import type * as lib_voiceExplainability from "../lib/voiceExplainability.js";
import type * as lib_voiceFingerprint from "../lib/voiceFingerprint.js";
import type * as lib_voiceScoring from "../lib/voiceScoring.js";
import type * as lib_voiceThresholds from "../lib/voiceThresholds.js";
import type * as lib_voiceTypes from "../lib/voiceTypes.js";
import type * as multiCandidate from "../multiCandidate.js";
import type * as onboarding from "../onboarding.js";
import type * as orgs from "../orgs.js";
import type * as postRevisions from "../postRevisions.js";
import type * as posts from "../posts.js";
import type * as sites from "../sites.js";
import type * as testEnv from "../testEnv.js";
import type * as users from "../users.js";
import type * as voiceActions from "../voiceActions.js";
import type * as voiceAnalytics from "../voiceAnalytics.js";
import type * as voiceCalibration from "../voiceCalibration.js";
import type * as voiceEngine from "../voiceEngine.js";
import type * as voiceEvaluations from "../voiceEvaluations.js";
import type * as voicePreferenceSignals from "../voicePreferenceSignals.js";
import type * as voicePreferences from "../voicePreferences.js";
import type * as voiceProfiles from "../voiceProfiles.js";
import type * as voiceReactions from "../voiceReactions.js";
import type * as voiceRegression from "../voiceRegression.js";
import type * as voiceRegressionData from "../voiceRegressionData.js";
import type * as voiceRunExplainability from "../voiceRunExplainability.js";
import type * as voiceRunMetrics from "../voiceRunMetrics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  ai: typeof ai;
  "ai/realtimeSuggestions": typeof ai_realtimeSuggestions;
  "ai/realtimeSuggestionsMetrics": typeof ai_realtimeSuggestionsMetrics;
  auth: typeof auth;
  editorialRuns: typeof editorialRuns;
  http: typeof http;
  "lib/aiClient": typeof lib_aiClient;
  "lib/calibrationDataset": typeof lib_calibrationDataset;
  "lib/candidateSelection": typeof lib_candidateSelection;
  "lib/candidateVariations": typeof lib_candidateVariations;
  "lib/embeddings": typeof lib_embeddings;
  "lib/nudges": typeof lib_nudges;
  "lib/preferenceSignals": typeof lib_preferenceSignals;
  "lib/profileConfidence": typeof lib_profileConfidence;
  "lib/prompts": typeof lib_prompts;
  "lib/reactionPanels": typeof lib_reactionPanels;
  "lib/realtimeSuggestions": typeof lib_realtimeSuggestions;
  "lib/slugify": typeof lib_slugify;
  "lib/voiceCorrection": typeof lib_voiceCorrection;
  "lib/voiceEnforcement": typeof lib_voiceEnforcement;
  "lib/voiceExplainability": typeof lib_voiceExplainability;
  "lib/voiceFingerprint": typeof lib_voiceFingerprint;
  "lib/voiceScoring": typeof lib_voiceScoring;
  "lib/voiceThresholds": typeof lib_voiceThresholds;
  "lib/voiceTypes": typeof lib_voiceTypes;
  multiCandidate: typeof multiCandidate;
  onboarding: typeof onboarding;
  orgs: typeof orgs;
  postRevisions: typeof postRevisions;
  posts: typeof posts;
  sites: typeof sites;
  testEnv: typeof testEnv;
  users: typeof users;
  voiceActions: typeof voiceActions;
  voiceAnalytics: typeof voiceAnalytics;
  voiceCalibration: typeof voiceCalibration;
  voiceEngine: typeof voiceEngine;
  voiceEvaluations: typeof voiceEvaluations;
  voicePreferenceSignals: typeof voicePreferenceSignals;
  voicePreferences: typeof voicePreferences;
  voiceProfiles: typeof voiceProfiles;
  voiceReactions: typeof voiceReactions;
  voiceRegression: typeof voiceRegression;
  voiceRegressionData: typeof voiceRegressionData;
  voiceRunExplainability: typeof voiceRunExplainability;
  voiceRunMetrics: typeof voiceRunMetrics;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
