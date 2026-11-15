import * as XLSX from 'xlsx';
import * as fs from 'fs';

// Parses Tervarit Juniorit's Talviliiga Google Sheet (exported as .xlsx).
//
// Two sources inside the workbook:
//  1. "Ilmoittautuneet joukkueet": every series (e.g. Pojat 5v5 P10 Taso 1), its
//     registered teams and its game days ("Pelipäivät") with the kiosk team.
//     This is the source of truth for upcoming tournament days.
//  2. "5v5 turnaukset" / "4v4 turnaukset": per-day schedule blocks with
//     time / field / team1 / team2. Blocks for future days are often empty
//     templates, and the sheet also contains leftover blocks from last season
//     with stale dates — those are dropped unless their date falls inside the
//     current season.

export const PARSER_VERSION = 1;

export interface Game {
  date: string;          // ISO YYYY-MM-DD
  time: string;          // HH:MM
  field: string;         // "Kenttä 1"
  location: string;      // "Kempele Areena"
  gameType: string;      // "5v5"
  gameDuration: string;  // "25 min" or ""
  team1: string;
  team2: string;
}

export interface SeriesDay {
  date: string;  // ISO
  kiosk: string;
}

export interface Series {
  id: string;        // "Pojat 5v5 P10 (2017) Taso 1 (EP)"
  organizer: string; // "Tervarit" | "OLS"
  gender: string;    // "Pojat" | "Tytöt"
  gameType: string;  // "5v5"
  ageGroup: string;  // "P10 (2017)"
  level: string;     // "Taso 1 (EP)"
  location: string;
  teams: string[];
  days: SeriesDay[];
}

export interface TournamentDay {
  date: string;
  organizer: string;
  gameType: string;      // "5v5", or "3v3 / 4v4" when a venue hosts several
  location: string;
  series: string[];      // series ids playing that day
  kiosk: string[];
  gamesPublished: number;
}

export interface GamesData {
  parserVersion: number;
  lastUpdated: string;
  sourceUrl: string;
  sourceHash?: string;
  season: string;
  games: Game[];
  series: Series[];
  days: TournamentDay[];
  warnings: string[];
}

type Cell = string | number | boolean | null;
type Rows = Cell[][];

const SCHEDULE_SHEETS: Record<string, string> = {
  '5v5 turnaukset': '5v5',
  '4v4 turnaukset': '4v4',
};
const REGISTRATION_SHEET = 'Ilmoittautuneet joukkueet';
const SEASON_MARGIN_DAYS = 14;

// ─── Cell helpers ─────────────────────────────────────────────────────────────

function sheetRows(wb: XLSX.WorkBook, name: string): Rows {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: null, raw: true, blankrows: true });
}

function str(v: Cell | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Excel serial date (days since 1899-12-30) or "Sat 14.11.2026" / "14.11.2026"
export function cellToDate(v: Cell | undefined): string | null {
  if (typeof v === 'number' && v > 40000 && v < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof v === 'string') {
    const m = v.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/);
    if (m) return isoDate(+m[3], +m[2], +m[1]);
  }
  return null;
}

function cellToTime(v: Cell | undefined): string | null {
  if (typeof v === 'number' && v > 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (m) return `${pad(+m[1])}:${m[2]}`;
  }
  return null;
}

const NOT_TEAM_RE = /aloittavat|tötsät|viimeiset|kentät|julkaistaan|täynnä/i;

function isTeamName(v: Cell | undefined): boolean {
  const s = str(v);
  return s.length > 1 && /[a-zåäö]/i.test(s) && !NOT_TEAM_RE.test(s);
}

export function teamKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Registration sheet: series, teams, game days ─────────────────────────────

const SERIES_HEADER_RE = /^(Pojat|Tytöt)\s*(\d)\s*v\s*(\d)$/i;

function parseSeries(rows: Rows, locations: Record<string, string>): Series[] {
  const result: Series[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const m = str(row[c]).match(SERIES_HEADER_RE);
      if (!m) continue;

      const gender = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      const gameType = `${m[2]}v${m[3]}`;
      const ageGroup = str(rows[r + 1]?.[c]);
      const level = str(rows[r + 2]?.[c]);

      // "Pelipäivät" header in the same column marks the end of the team list
      let daysHeader = -1;
      for (let rr = r + 3; rr < Math.min(rows.length, r + 60); rr++) {
        if (/^pelipäivät$/i.test(str(rows[rr]?.[c]))) { daysHeader = rr; break; }
        if (rr > r + 3 && SERIES_HEADER_RE.test(str(rows[rr]?.[c]))) break;
      }
      if (daysHeader === -1) continue;

      const teams: string[] = [];
      for (let rr = r + 3; rr < daysHeader; rr++) {
        const v = rows[rr]?.[c];
        if (typeof v === 'string' && isTeamName(v) && !/ottelumäärä|taso|ei tasojakoa/i.test(v)) {
          teams.push(str(v));
        }
      }

      const days: SeriesDay[] = [];
      for (let rr = daysHeader + 1; rr < rows.length; rr++) {
        const date = cellToDate(rows[rr]?.[c]);
        if (!date) break;
        days.push({ date, kiosk: str(rows[rr]?.[c + 1]) });
      }

      result.push({
        id: [gender, gameType, ageGroup, level].filter(Boolean).join(' '),
        organizer: 'Tervarit',
        gender, gameType, ageGroup, level,
        location: locations[gameType] ?? '',
        teams, days,
      });
    }
  }
  return result;
}

// ─── Schedule sheets: per-day game blocks ─────────────────────────────────────

const LOCATION_RE = /\b(areena|halli)$/i;

function findLocation(rows: Rows): string {
  for (const row of rows.slice(0, 40)) {
    for (const v of (row ?? []).slice(0, 10)) {
      const s = str(v);
      if (LOCATION_RE.test(s)) return s;
    }
  }
  return '';
}

interface Block {
  date: string | null;
  location: string;
  duration: string;
  fields: { col: number; name: string }[];
  skip: boolean;
  startRow: number;
  games: Game[];
}

function parseScheduleSheet(
  rows: Rows, gameType: string, sheetName: string,
  seasonStart: string, seasonEnd: string, warnings: string[],
): Game[] {
  const games: Game[] = [];
  const seenDates = new Set<string>();
  let block: Block | null = null;

  const closeBlock = () => {
    if (!block) return;
    if (block.games.length > 0) {
      const where = `${sheetName} rivi ${block.startRow + 1}`;
      if (!block.date) {
        warnings.push(`${where}: ${block.games.length} peliä ilman päivämäärää – ohitettu`);
      } else if (block.skip) {
        // reason already reported when the block was opened
      } else {
        games.push(...block.games);
      }
    }
    block = null;
  };

  const openBlock = (r: number, location: string) => {
    closeBlock();
    block = { date: null, location, duration: '', fields: [], skip: false, startRow: r, games: [] };
  };

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const head = row.slice(0, 10);

    // A location cell starts a new block (4v4: location row comes before the date row)
    const loc = head.map(str).find(s => LOCATION_RE.test(s));
    if (loc) openBlock(r, loc);

    // Date in the leftmost columns (the right-hand side has the series tables)
    for (const v of row.slice(0, 5)) {
      const date = cellToDate(v);
      if (!date) continue;
      if (!block || block.date) openBlock(r, block?.location ?? '');
      const b = block!;
      b.date = date;
      if (seenDates.has(date)) {
        b.skip = true;           // later copy of an already parsed day
      } else if (date < seasonStart || date > seasonEnd) {
        b.skip = true;           // stale block from an earlier season (see staleWarnings)
      } else {
        seenDates.add(date);
      }
      break;
    }

    if (!block) continue;
    const b: Block = block;

    for (const v of head) {
      const m = str(v).match(/PELIAIKA\s*(\d+)\s*MIN/i);
      if (m) b.duration = `${m[1]} min`;
    }

    // Header row: "Peliaika | Kenttä 1 | | Peliaika | Kenttä 2 ..."
    const peliaikaCols = row.map((v, i) => (/^peliaika$/i.test(str(v)) ? i : -1)).filter(i => i >= 0);
    if (peliaikaCols.length > 0) {
      b.fields = peliaikaCols.map((col, i) => ({ col, name: str(row[col + 1]) || `Kenttä ${i + 1}` }));
      continue;
    }

    for (const f of b.fields) {
      const time = cellToTime(row[f.col]);
      if (!time) continue;
      const t1 = row[f.col + 1], t2 = row[f.col + 2];
      if (!isTeamName(t1) || !isTeamName(t2)) continue;
      b.games.push({
        date: b.date ?? '',
        time,
        field: f.name,
        location: b.location,
        gameType,
        gameDuration: b.duration,
        team1: str(t1),
        team2: str(t2),
      });
    }
  }
  closeBlock();

  return games;
}

// Second pass for stale-date warnings: re-run block detection cheaply by
// counting games under blocks whose date is outside the season.
function staleWarnings(rows: Rows, sheetName: string, seasonStart: string, seasonEnd: string): string[] {
  const out: string[] = [];
  let date: string | null = null, row0 = 0, count = 0;
  const flush = () => {
    if (date && (date < seasonStart || date > seasonEnd) && count > 0) {
      out.push(`${sheetName} rivi ${row0 + 1}: ${count} peliä päivällä ${date}, joka ei ole kuluvalla kaudella – ohitettu`);
    }
  };
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const d = row.slice(0, 5).map(cellToDate).find(Boolean) ?? null;
    if (d) { flush(); date = d; row0 = r; count = 0; continue; }
    for (let c = 0; c < row.length - 2; c++) {
      if (cellToTime(row[c]) && isTeamName(row[c + 1]) && isTeamName(row[c + 2])) count++;
    }
  }
  flush();
  return out;
}

// ─── Tournament days ──────────────────────────────────────────────────────────

// Tournament days = union of series days, one entry per date + venue.
export function buildDays(series: Series[], games: Game[], warnings: string[]): TournamentDay[] {
  const dayMap = new Map<string, TournamentDay & { types: Set<string> }>();
  const get = (date: string, location: string, organizer: string) => {
    const key = `${date}|${location}`;
    let day = dayMap.get(key);
    if (!day) {
      day = { date, organizer, gameType: '', location, series: [], kiosk: [], gamesPublished: 0, types: new Set() };
      dayMap.set(key, day);
    }
    return day;
  };
  for (const s of series) {
    for (const d of s.days) {
      const day = get(d.date, s.location, s.organizer);
      day.series.push(s.id);
      day.types.add(s.gameType);
      if (d.kiosk && !day.kiosk.includes(d.kiosk)) day.kiosk.push(d.kiosk);
    }
  }
  for (const g of games) {
    const key = `${g.date}|${g.location}`;
    if (!dayMap.has(key)) warnings.push(`${g.location}: pelejä päivälle ${g.date}, jota ei ole sarjojen pelipäivissä`);
    const day = get(g.date, g.location, series[0]?.organizer ?? '');
    day.types.add(g.gameType);
    day.gamesPublished++;
  }
  return [...dayMap.values()]
    .map(({ types, ...d }) => ({ ...d, gameType: [...types].sort().join(' / ') }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location, 'fi'));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function parseWorkbook(buf: Buffer | Uint8Array, sourceUrl = ''): GamesData {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const warnings: string[] = [];

  const locations: Record<string, string> = {};
  for (const [sheet, gameType] of Object.entries(SCHEDULE_SHEETS)) {
    locations[gameType] = findLocation(sheetRows(wb, sheet));
  }

  const regRows = sheetRows(wb, REGISTRATION_SHEET);
  const season = str(regRows[0]?.[0]).match(/(\d{4})\s*[-/]\s*(\d{2,4})/)?.[0] ?? '';
  const series = parseSeries(regRows, locations);
  if (series.length === 0) warnings.push(`"${REGISTRATION_SHEET}": sarjoja ei löytynyt`);

  const allDays = series.flatMap(s => s.days.map(d => d.date)).sort();
  const seasonStart = allDays.length ? addDays(allDays[0], -SEASON_MARGIN_DAYS) : '0000-00-00';
  const seasonEnd = allDays.length ? addDays(allDays[allDays.length - 1], SEASON_MARGIN_DAYS) : '9999-99-99';

  const games: Game[] = [];
  for (const [sheet, gameType] of Object.entries(SCHEDULE_SHEETS)) {
    const rows = sheetRows(wb, sheet);
    if (rows.length === 0) { warnings.push(`Välilehteä "${sheet}" ei löytynyt`); continue; }
    games.push(...parseScheduleSheet(rows, gameType, sheet, seasonStart, seasonEnd, warnings));
    warnings.push(...staleWarnings(rows, sheet, seasonStart, seasonEnd));
  }
  games.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.field.localeCompare(b.field));

  const days = buildDays(series, games, warnings);

  return {
    parserVersion: PARSER_VERSION,
    lastUpdated: new Date().toISOString(),
    sourceUrl,
    season,
    games,
    series,
    days,
    warnings: [...new Set(warnings)],
  };
}

export function parseFile(filePath: string, sourceUrl = ''): GamesData {
  return parseWorkbook(fs.readFileSync(filePath), sourceUrl);
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: bun run src/parser.ts <file.xlsx>');
    process.exit(1);
  }
  const data = parseFile(file);
  console.log(`Season ${data.season}: ${data.series.length} series, ${data.games.length} games, ${data.days.length} days`);
  for (const d of data.days) {
    console.log(`  ${d.date} ${d.gameType} ${d.location}: ${d.series.length} sarjaa, ${d.gamesPublished} peliä`);
  }
  for (const w of data.warnings) console.warn('  ! ' + w);
}
