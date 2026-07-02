import * as cheerio from "cheerio";

export const CLUBSPEED_BASE = "https://pgpkent.clubspeedtiming.com/sp_center";

// ClubSpeed's #lblDate has no timezone info and reflects the track's local
// wall-clock time (Kent, WA - America/Los_Angeles). `new Date(dateText)`
// would parse it as the server process's local time (UTC on Convex), which
// silently mislabels every timestamp by the Pacific UTC offset. These
// helpers convert a Pacific wall-clock time to the correct UTC instant,
// using the standard US DST rule (2nd Sunday of March - 1st Sunday of
// November) since Convex's runtime doesn't reliably support IANA timezone
// data via Intl.
function nthSundayOfMonth(year: number, month: number, n: number): number {
  const firstOfMonthDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstOfMonthDow) % 7);
  return firstSunday + (n - 1) * 7;
}

function isPacificDst(year: number, month: number, day: number): boolean {
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  if (month === 3) return day >= nthSundayOfMonth(year, 3, 2);
  return day < nthSundayOfMonth(year, 11, 1); // month === 11
}

function pacificOffsetMinutes(year: number, month: number, day: number): number {
  return isPacificDst(year, month, day) ? -420 : -480; // PDT: UTC-7, PST: UTC-8
}

function trackLocalToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  return naiveUtcMs - pacificOffsetMinutes(year, month, day) * 60_000;
}

/** Reinterprets a timestamp that was previously (incorrectly) computed by
 * treating the track's Pacific wall-clock time as UTC, recovering the
 * correct UTC instant. Used both for parsing fresh pages and for
 * one-time correction of already-stored timestamps. */
export function correctTrackLocalTimestamp(mislabeledUtcMs: number): number {
  const d = new Date(mislabeledUtcMs);
  return trackLocalToUtcMs(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  );
}

function parseTrackLocalDateTime(dateText: string): number {
  const match = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return Date.now();
  const [, moStr, dayStr, yearStr, hourStr, minStr, ampm] = match;
  const month = parseInt(moStr, 10);
  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  let hour = parseInt(hourStr, 10) % 12;
  if (/pm/i.test(ampm)) hour += 12;
  const minute = parseInt(minStr, 10);
  return trackLocalToUtcMs(year, month, day, hour, minute);
}

export interface ParsedResultRow {
  position: number;
  name: string;
  custId?: string;
  teamName?: string;
  bestLapMs?: number;
  gapFromLeaderMs?: number;
  numLaps?: number;
  avgLapMs?: number;
  proSkill?: number;
}

export interface ParsedLap {
  lapNo: number;
  lapTimeMs: number;
  positionAtLap?: number;
}

export interface ParsedHeatDetails {
  rawHeatType: string;
  raceDateTime: number;
  winnerRaw: string;
  results: ParsedResultRow[];
  lapsByName: Map<string, ParsedLap[]>;
}

function secondsTextToMs(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const cleaned = text.trim();
  if (!cleaned || cleaned === "-") return undefined;
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return undefined;
  return Math.round(n * 1000);
}

function intText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const n = parseInt(text.trim(), 10);
  return Number.isNaN(n) ? undefined : n;
}

function decodeCustId(href: string): string | undefined {
  const match = href.match(/CustID=([^&'"]+)/);
  if (!match) return undefined;
  try {
    return Buffer.from(decodeURIComponent(match[1]), "base64").toString("utf-8").trim();
  } catch {
    return undefined;
  }
}

function positionFromLabel(label: string): number {
  if (/winner/i.test(label)) return 1;
  const m = label.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function parseHeatDetailsHtml(html: string): ParsedHeatDetails {
  const $ = cheerio.load(html);

  const rawHeatType = $("#lblRaceType").text().trim();
  const dateText = $("#lblDate").text().trim();
  const raceDateTime = dateText ? parseTrackLocalDateTime(dateText) : Date.now();
  const winnerRaw = $("#lblWinner").text().trim();

  const results: ParsedResultRow[] = [];
  let current: Partial<ParsedResultRow> | null = null;

  $("table.RaceResults > tbody > tr").each((_, tr) => {
    const $tr = $(tr);
    const hasPosition = $tr.find("td.Position").length > 0;
    const hasRacername = $tr.find("td.Racername").length > 0;
    const hasBestLap = $tr.find("td.BestLap").length > 0;
    const hasRPM = $tr.find("td.RPM").length > 0;

    if (!hasPosition && !hasRacername && !hasBestLap && !hasRPM) {
      return; // HeaderRow or stray whitespace row
    }

    const readNameFields = (target: Partial<ParsedResultRow>) => {
      const $link = $tr.find("td.Racername a");
      if ($link.length > 0) {
        target.name = $link.text().trim();
        target.custId = decodeCustId($link.attr("href") ?? "");
      } else if (hasRacername) {
        target.name = $tr.find("td.Racername").text().replace(/^Racer/, "").trim();
        target.teamName = target.name;
      }
    };

    const readStatFields = (target: Partial<ParsedResultRow>) => {
      if (hasBestLap) {
        target.bestLapMs = secondsTextToMs($tr.find("td.BestLap span").first().text());
        target.numLaps = intText($tr.find("td.Laps span").first().text());
        const gapText = $tr.find("td.Gap span").first().text().trim();
        target.gapFromLeaderMs = gapText === "-" ? 0 : secondsTextToMs(gapText);
        target.avgLapMs = secondsTextToMs($tr.find("td.AvgLap span").first().text());
      }
      if (hasRPM) {
        target.proSkill = intText($tr.find("td.RPM span").first().text());
      }
    };

    if (hasPosition && hasRacername && hasBestLap && hasRPM) {
      // Regular row (position 4+): every field lives in this one <tr>.
      const row: Partial<ParsedResultRow> = {
        position: intText($tr.find("td.Position span").first().text()) ?? 0,
      };
      readNameFields(row);
      readStatFields(row);
      results.push(row as ParsedResultRow);
      return;
    }

    if (hasPosition && hasRacername) {
      // First row of a Top3Winners 3-row group.
      const label = $tr.find("td.Position").first().text().trim();
      current = { position: positionFromLabel(label) };
      readNameFields(current);
      return;
    }

    if (current && hasBestLap) {
      readStatFields(current);
    }
    if (current && hasRPM) {
      readStatFields(current);
      results.push(current as ParsedResultRow);
      current = null;
    }
  });

  const lapsByName = new Map<string, ParsedLap[]>();
  $("table.LapTimesContainer table.LapTimes").each((_, table) => {
    const $table = $(table);
    const name = $table.find("thead th").first().text().trim();
    if (!name) return;
    const laps: ParsedLap[] = [];
    $table.find("tbody tr.LapTimesRow, tbody tr.LapTimesRowAlt").each((_, tr) => {
      const cells = $(tr).find("td");
      const lapNo = intText($(cells[0]).text());
      const timeText = $(cells[1]).text().trim();
      const m = timeText.match(/^([\d.]+)\s*\[(\d+)\]/);
      if (lapNo === undefined || !m) return; // blank/&nbsp; lap - not recorded
      laps.push({
        lapNo,
        lapTimeMs: Math.round(parseFloat(m[1]) * 1000),
        positionAtLap: parseInt(m[2], 10),
      });
    });
    lapsByName.set(name, laps);
  });

  return { rawHeatType, raceDateTime, winnerRaw, results, lapsByName };
}

export interface ParsedRacerHistory {
  displayName: string;
  kartsByHeatNo: { heatNo: number; kartNo: number }[];
}

export function parseRacerHistoryHtml(html: string): ParsedRacerHistory {
  const $ = cheerio.load(html);
  const displayName = $("#lblRacerName").text().trim();
  const kartsByHeatNo: { heatNo: number; kartNo: number }[] = [];

  $("table#dg tr.Normal").each((_, tr) => {
    const $link = $(tr).find("a[href*='HeatDetails.aspx?HeatNo=']").first();
    if ($link.length === 0) return;
    const heatMatch = ($link.attr("href") ?? "").match(/HeatNo=(\d+)/);
    const kartMatch = $link.text().match(/-\s*Kart\s*(\d+)\s*$/i);
    if (heatMatch && kartMatch) {
      kartsByHeatNo.push({ heatNo: parseInt(heatMatch[1], 10), kartNo: parseInt(kartMatch[1], 10) });
    }
  });

  return { displayName, kartsByHeatNo };
}
