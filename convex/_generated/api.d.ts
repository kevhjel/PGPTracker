/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_backfillDriver from "../actions/backfillDriver.js";
import type * as actions_scrapeHeats from "../actions/scrapeHeats.js";
import type * as appSettings from "../appSettings.js";
import type * as crons from "../crons.js";
import type * as drivers from "../drivers.js";
import type * as heats from "../heats.js";
import type * as lib_adminAuth from "../lib/adminAuth.js";
import type * as lib_clubspeedParser from "../lib/clubspeedParser.js";
import type * as lib_heatType from "../lib/heatType.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/backfillDriver": typeof actions_backfillDriver;
  "actions/scrapeHeats": typeof actions_scrapeHeats;
  appSettings: typeof appSettings;
  crons: typeof crons;
  drivers: typeof drivers;
  heats: typeof heats;
  "lib/adminAuth": typeof lib_adminAuth;
  "lib/clubspeedParser": typeof lib_clubspeedParser;
  "lib/heatType": typeof lib_heatType;
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
