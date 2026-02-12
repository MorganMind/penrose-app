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
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_slugify from "../lib/slugify.js";
import type * as orgs from "../orgs.js";
import type * as postRevisions from "../postRevisions.js";
import type * as posts from "../posts.js";
import type * as sites from "../sites.js";
import type * as testEnv from "../testEnv.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  ai: typeof ai;
  auth: typeof auth;
  http: typeof http;
  "lib/prompts": typeof lib_prompts;
  "lib/slugify": typeof lib_slugify;
  orgs: typeof orgs;
  postRevisions: typeof postRevisions;
  posts: typeof posts;
  sites: typeof sites;
  testEnv: typeof testEnv;
  users: typeof users;
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
