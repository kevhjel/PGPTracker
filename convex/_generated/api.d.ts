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
import type * as actions_parseGpx from "../actions/parseGpx.js";
import type * as actions_scrapeHeats from "../actions/scrapeHeats.js";
import type * as appSettings from "../appSettings.js";
import type * as crons from "../crons.js";
import type * as drivers from "../drivers.js";
import type * as gps from "../gps.js";
import type * as heats from "../heats.js";
import type * as lib_adminAuth from "../lib/adminAuth.js";
import type * as lib_clubspeedParser from "../lib/clubspeedParser.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_gpxParse from "../lib/gpxParse.js";
import type * as lib_heatType from "../lib/heatType.js";
import type * as lib_lapSplit from "../lib/lapSplit.js";
import type * as lib_trackSchedule from "../lib/trackSchedule.js";
import type * as lib_wetDetection from "../lib/wetDetection.js";
import type * as lib_youtube from "../lib/youtube.js";
import type * as wetDetection from "../wetDetection.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/backfillDriver": typeof actions_backfillDriver;
  "actions/parseGpx": typeof actions_parseGpx;
  "actions/scrapeHeats": typeof actions_scrapeHeats;
  appSettings: typeof appSettings;
  crons: typeof crons;
  drivers: typeof drivers;
  gps: typeof gps;
  heats: typeof heats;
  "lib/adminAuth": typeof lib_adminAuth;
  "lib/clubspeedParser": typeof lib_clubspeedParser;
  "lib/constants": typeof lib_constants;
  "lib/geo": typeof lib_geo;
  "lib/gpxParse": typeof lib_gpxParse;
  "lib/heatType": typeof lib_heatType;
  "lib/lapSplit": typeof lib_lapSplit;
  "lib/trackSchedule": typeof lib_trackSchedule;
  "lib/wetDetection": typeof lib_wetDetection;
  "lib/youtube": typeof lib_youtube;
  wetDetection: typeof wetDetection;
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
