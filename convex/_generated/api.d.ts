/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as broll from "../broll.js";
import type * as ideas from "../ideas.js";
import type * as instagram from "../instagram.js";
import type * as library from "../library.js";
import type * as libraryActions from "../libraryActions.js";
import type * as projects from "../projects.js";
import type * as styleBank from "../styleBank.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  broll: typeof broll;
  ideas: typeof ideas;
  instagram: typeof instagram;
  library: typeof library;
  libraryActions: typeof libraryActions;
  projects: typeof projects;
  styleBank: typeof styleBank;
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
