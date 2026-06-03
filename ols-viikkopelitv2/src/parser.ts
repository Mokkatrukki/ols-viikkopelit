import * as fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Game {
  field: string;
  gameDuration: string;
  gameType: string;
  year: string;
  time: string;
  team1: string;
  team2: string;
  date: string;
  location: string;
}

export interface DateGroup {
  date: string;
  fullDate: string;
  games: Game[];
}

export interface GamesData {
  lastUpdated: string;
  pdfUrl: string;
  pdfHash?: string;
  documentDate: string;
  games: Game[];
  gamesByDate: DateGroup[];
}

interface TextItem {
  text: string;
  x: number;
  y: number;
}

const TIME_RE = /^\d{1,2}[\.:]\s*\d{2}\s*-\s*\d{1,2}[\.:]\s*\d{2}$/;
const MIN_RE = /^\d+\s+min$/i;
const VV_RE = /\d+\s*v\s*\d+/;
const YEAR4_RE = /^\d{4}/;

// Normalize field names from PDF: fix missing spaces around dashes and collapse extra whitespace.
// e.g. "HEPA- HALLI D" → "HEPA - HALLI D", "HEPA -HALLI D" → "HEPA - HALLI D"
function normalizeFieldName(name: string): string {
  return name
    .trim()
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── PDF extraction ───────────────────────────────────────────────────────────

async function extractTextItems(filePath: string): Promise<TextItem[]> {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdf = await (pdfjsLib as any).getDocument({ data }).promise;
  const items: TextItem[] = [];

  // Each page gets a negative y-offset so pages stay ordered and don't overlap.
  // Page 1: y as-is (~0-842), page 2: y-2000, page 3: y-4000, etc.
  // Sorted descending → page 1 first, page 2 next.
  const PAGE_Y_SEP = 2000;

  for (let p = 1; p <= pdf.numPages; p++) {
    const yOffset = -(p - 1) * PAGE_Y_SEP;
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      if (item.str.trim()) {
        items.push({
          text: item.str,
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]) + yOffset,
        });
      }
    }
  }

  return items.sort((a, b) => b.y - a.y || a.x - b.x);
}

// ─── Row grouping ─────────────────────────────────────────────────────────────

function groupIntoRows(items: TextItem[]): TextItem[][] {
  const rowMap = new Map<number, TextItem[]>();
  for (const item of items) {
    let merged = false;
    for (const ry of rowMap.keys()) {
      if (Math.abs(item.y - ry) <= 3) { rowMap.get(ry)!.push(item); merged = true; break; }
    }
    if (!merged) rowMap.set(item.y, [item]);
  }
  return [...rowMap.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, row]) => row.sort((a, b) => a.x - b.x));
}

// ─── Column position detection (the robust part) ──────────────────────────────
//
// Collect x-coordinates from ALL time items (HH:MM - HH:MM) across all rows,
// then cluster them. Each cluster = one column. Columns are sorted left→right.
// This makes the parser layout-agnostic: column positions come from the data,
// not from hardcoded coordinates or "min" item positions.

function detectColumnPositions(rows: TextItem[][]): number[] {
  const xs: number[] = [];
  for (const row of rows) {
    for (const item of row) {
      if (TIME_RE.test(item.text)) xs.push(item.x);
    }
  }
  if (!xs.length) return [];

  const CLUSTER_TOL = 15; // px — items within 15px = same column
  const clusters: number[][] = [];
  for (const x of xs) {
    let found = false;
    for (const c of clusters) {
      if (Math.abs(c[0] - x) <= CLUSTER_TOL) { c.push(x); found = true; break; }
    }
    if (!found) clusters.push([x]);
  }

  return clusters
    .map(c => Math.round(c.reduce((a, b) => a + b, 0) / c.length))
    .sort((a, b) => a - b);
}

// Which column does this x belong to?
// Column i spans [colPositions[i], colPositions[i+1]).
function getColIndex(x: number, colPositions: number[]): number {
  for (let i = colPositions.length - 1; i >= 0; i--) {
    if (x >= colPositions[i]) return i;
  }
  return 0;
}

// ─── Section detection ────────────────────────────────────────────────────────
//
// A "section" = one paired block of fields (e.g., PÖRHÖ AREENA 1A + 1B).
// Structure: [field header row] → [game-type row] → [game rows...]
// We find sections by locating game-type rows, then backtrack for the header.

interface Section {
  fieldRow: TextItem[];
  gameTypeRow: TextItem[];
  gameRows: TextItem[][];
}

function findSections(rows: TextItem[][]): Section[] {
  // Indices of game-type rows: has "N min" AND "N v N"
  const gameTypeIdxs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.some(it => MIN_RE.test(it.text.trim())) && row.some(it => VV_RE.test(it.text))) {
      gameTypeIdxs.push(i);
    }
  }

  const sections: Section[] = [];
  for (let s = 0; s < gameTypeIdxs.length; s++) {
    const gtIdx = gameTypeIdxs[s];
    const nextGtIdx = gameTypeIdxs[s + 1] ?? rows.length;

    // Field header = the closest non-empty row before the game-type row
    let hIdx = gtIdx - 1;
    while (hIdx >= 0 && rows[hIdx].length === 0) hIdx--;
    const fieldRow = hIdx >= 0 ? rows[hIdx] : [];

    const gameRows = rows.slice(gtIdx + 1, nextGtIdx);

    sections.push({ fieldRow, gameTypeRow: rows[gtIdx], gameRows });
  }

  return sections;
}

// ─── Section parsing ──────────────────────────────────────────────────────────

function extractSectionMeta(
  fieldRow: TextItem[],
  gameTypeRow: TextItem[],
  colPositions: number[],
): { fields: string[]; durations: string[]; gameTypes: string[]; years: string[] } {
  const n = colPositions.length;
  const fields = Array<string>(n).fill('');
  const durations = Array<string>(n).fill('15MIN');
  const gameTypes = Array<string>(n).fill('3 v 3');
  const years = Array<string>(n).fill('');

  // Field names from header row
  for (const item of fieldRow) {
    const col = getColIndex(item.x, colPositions);
    fields[col] = fields[col] ? `${fields[col]} ${item.text}` : item.text;
  }

  // Duration, game type, year from game-type row
  for (const item of gameTypeRow) {
    const col = getColIndex(item.x, colPositions);

    if (MIN_RE.test(item.text.trim())) {
      const m = item.text.match(/(\d+)/);
      if (m) durations[col] = `${m[1]}MIN`;
      continue;
    }
    if (VV_RE.test(item.text)) {
      const m = item.text.match(/(\d+)\s*v\s*(\d+)/);
      if (m) gameTypes[col] = `${m[1]} v ${m[2]}`;
      continue;
    }
    if (YEAR4_RE.test(item.text.trim())) {
      const m = item.text.match(/^(\d{4})/);
      if (m) years[col] = m[1];
    }
  }

  return { fields: fields.map(normalizeFieldName), durations, gameTypes, years };
}

function extractGamesFromRow(
  row: TextItem[],
  colPositions: number[],
  meta: { fields: string[]; durations: string[]; gameTypes: string[]; years: string[] },
  date: string,
): Game[] {
  const games: Game[] = [];
  const timeItems = row.filter(it => TIME_RE.test(it.text));

  for (const timeItem of timeItems) {
    const col = getColIndex(timeItem.x, colPositions);
    const field = meta.fields[col];
    if (!field) continue;

    // Team items: non-time, to the right of this time item, before next column starts
    const nextColX = colPositions[col + 1] ?? Infinity;
    const teamItems = row
      .filter(it =>
        it.x > timeItem.x &&
        it.x < nextColX &&
        !TIME_RE.test(it.text) &&
        it.text.trim().length > 0
      )
      .slice(0, 2);

    if (teamItems.length !== 2) continue;

    const time = parseTimeRange(timeItem.text);
    if (!time) continue;

    // Location = field name without trailing field letter (e.g. "PÖRHÖ AREENA 1A" → "PÖRHÖ AREENA")
    const locMatch = field.match(/^(.+?)\s+\d*[A-H]$/);
    const location = locMatch ? locMatch[1].trim() : field;

    games.push({
      field,
      gameDuration: meta.durations[col],
      gameType: meta.gameTypes[col],
      year: meta.years[col],
      time,
      team1: teamItems[0].text.trim(),
      team2: teamItems[1].text.trim(),
      date,
      location,
    });
  }

  return games;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseTimeRange(s: string): string | null {
  const m = s.match(/(\d{1,2})[\.:]\s*(\d{2})\s*-\s*(\d{1,2})[\.:]\s*(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function extractDocumentDate(
  flatText: string,
  pdfUrl: string,
): { date: string; fullDate: string } {
  // Finnish weekday + date: "TORSTAI 7.5.2026"
  const weekdayM = flatText.match(
    /(?:MAANANTAI|TIISTAI|KESKIVIIKKO|TORSTAI|PERJANTAI|LAUANTAI|SUNNUNTAI)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i
  );
  if (weekdayM) {
    const d = parseInt(weekdayM[1]), mo = parseInt(weekdayM[2]), y = weekdayM[3];
    return { fullDate: `${String(d).padStart(2,'0')}.${String(mo).padStart(2,'0')}.${y}`, date: `${d}.${mo}` };
  }

  // Plain date anywhere in text: "7.5.2026"
  const plainM = flatText.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  if (plainM) {
    const d = parseInt(plainM[1]), mo = parseInt(plainM[2]), y = plainM[3];
    return { fullDate: `${String(d).padStart(2,'0')}.${String(mo).padStart(2,'0')}.${y}`, date: `${d}.${mo}` };
  }

  // Fallback: parse from PDF URL filename "Viikkopelit-7_5_2026.pdf"
  const urlM = pdfUrl.match(/Viikkopelit-(\d+)_(\d+)_(\d{4})\.pdf/i);
  if (urlM) {
    const d = parseInt(urlM[1]), mo = parseInt(urlM[2]), y = urlM[3];
    return { fullDate: `${String(d).padStart(2,'0')}.${String(mo).padStart(2,'0')}.${y}`, date: `${d}.${mo}` };
  }

  return { date: '', fullDate: '' };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function parsePdf(filePath: string, pdfUrl = ''): Promise<GamesData> {
  const items = await extractTextItems(filePath);
  const rows = groupIntoRows(items);
  const flatText = items.map(i => i.text).join(' ');

  // Document date
  const { date: docShortDate, fullDate: documentDate } = extractDocumentDate(flatText, pdfUrl);
  const dateFullMap = new Map<string, string>();
  if (docShortDate) dateFullMap.set(docShortDate, documentDate);

  // Global column positions from ALL time items
  const colPositions = detectColumnPositions(rows);
  if (!colPositions.length) {
    return { lastUpdated: new Date().toISOString(), pdfUrl, documentDate, games: [], gamesByDate: [] };
  }

  // Find sections and extract games
  const sections = findSections(rows);
  const games: Game[] = [];

  for (const section of sections) {
    const meta = extractSectionMeta(section.fieldRow, section.gameTypeRow, colPositions);

    for (const row of section.gameRows) {
      const rowGames = extractGamesFromRow(row, colPositions, meta, docShortDate);
      games.push(...rowGames);
    }
  }

  // Build gamesByDate
  const dateGamesMap = new Map<string, Game[]>();
  for (const game of games) {
    if (!dateGamesMap.has(game.date)) dateGamesMap.set(game.date, []);
    dateGamesMap.get(game.date)!.push(game);
  }

  const gamesByDate: DateGroup[] = [...dateGamesMap.entries()].map(([date, dg]) => ({
    date,
    fullDate: dateFullMap.get(date) || documentDate,
    games: dg,
  }));

  gamesByDate.sort((a, b) => {
    const [ad, am] = a.date.split('.').map(Number);
    const [bd, bm] = b.date.split('.').map(Number);
    return am !== bm ? am - bm : ad - bd;
  });

  return { lastUpdated: new Date().toISOString(), pdfUrl, documentDate, games, gamesByDate, pdfHash: '' };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const pdfPath = process.argv[2];
  const outputPath = process.argv[3] || './data/games.json';

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error('Usage: bun run src/parser.ts <pdf-path> [output-path]');
    process.exit(1);
  }

  const result = await parsePdf(pdfPath);
  fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Parsed ${result.games.length} games → ${outputPath}`);
  if (result.games.length) {
    result.games.slice(0, 5).forEach(g =>
      console.log(`  ${g.date} ${g.time} | ${g.field} | ${g.team1} vs ${g.team2} (${g.gameType}, ${g.gameDuration})`));
  }
}
