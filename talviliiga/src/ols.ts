import { createHash } from 'crypto';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDays, teamKey } from './parser.ts';
import type { Game, GamesData, Series } from './parser.ts';

// OLS's own Talviliiga (U6–U10, Pörhö Areena).
//  - https://ols.fi/jalkapallo/talviliiga/ lists game days, age groups,
//    game format per age group and registered teams per level (EP / VP).
//  - Schedules are PDFs "Talviliiga<ddmmyy><rev>.pdf" in wp-content/uploads,
//    usually published a few days before each game day.

export const OLS_PAGE = 'https://ols.fi/jalkapallo/talviliiga/';
const UPLOADS_BASE = 'https://ols.fi/wp-content/uploads';
const HEADERS = { 'User-Agent': 'talviliiga-bot/2.0' };
export const OLS_PARSER_VERSION = 1;

export interface OlsPdf {
  url: string;
  date: string;      // ISO, from file name
  revision: number;
  hash?: string;
  games?: Game[];
  parserVersion?: number;
  warnings?: string[];
}

export interface OlsData extends GamesData {
  pdfs: OlsPdf[];
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö',
    aring: 'å', Aring: 'Å', euro: '€', ndash: '–', mdash: '—',
  };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n] ?? m);
}

function htmlToLines(html: string): string[] {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase());
}

// ─── Page parsing ─────────────────────────────────────────────────────────────

export interface OlsPage {
  season: string;
  location: string;
  hours: string;
  days: string[];                         // ISO
  series: Series[];
  pdfLinks: string[];
  warnings: string[];
}

export function parseOlsPage(html: string): OlsPage {
  const warnings: string[] = [];
  const text = htmlToLines(html).join('\n');

  const seasonM = text.match(/TALVILIIGA\s+(\d{4})\s*[-–]\s*(\d{4})/i);
  const startYear = seasonM ? +seasonM[1] : new Date().getFullYear();
  const season = seasonM ? `${seasonM[1]}-${seasonM[2].slice(2)}` : '';

  const location = titleCase(text.match(/PELIPAIKKA:\s*([^\n]+)/i)?.[1].trim() ?? 'Pörhö Areena');
  const daysLine = text.match(/PELIPÄIVÄT([^\n:]*):\s*([^\n]+)/i);
  const hours = daysLine?.[1].match(/(\d{1,2}[.:]\d{2})\s*[-–]\s*(\d{1,2}[.:]\d{2})/)?.slice(1).join('–') ?? '';
  const days = [...(daysLine?.[2] ?? '').matchAll(/(\d{1,2})\.(\d{1,2})\.?(\d{4})?/g)].map(m => {
    const d = +m[1], mo = +m[2];
    const y = m[3] ? +m[3] : mo >= 7 ? startYear : startYear + 1;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  });
  if (days.length === 0) warnings.push('OLS: pelipäiviä ei löytynyt sivulta');

  // Game format per age group: "U6 (2021 syntyneet) ... Pelimuoto: 3v3"
  const formats = new Map<string, string>();
  for (const m of text.matchAll(/(U\d+)\s*\((\d{4}) syntyneet\)[\s\S]*?Pelimuoto:\s*(\d\s*v\s*\d)/gi)) {
    formats.set(m[2], m[3].replace(/\s/g, ''));
  }

  // Age-group tabs, in the same order as the tab panels
  const tabs = [...html.matchAll(/role="tab"[^>]*>([\s\S]*?)<\/button>/gi)]
    .map(m => htmlToLines(m[1]).join(' ').match(/(U\d+)\s*\((\d{4})\)/))
    .filter((m): m is RegExpMatchArray => !!m);
  const panels = html.split(/role="tabpanel"/i).slice(1);

  const series: Series[] = [];
  tabs.forEach((tab, i) => {
    const [, age, year] = tab;
    const gameType = formats.get(year) ?? (+year >= 2020 ? '3v3' : '4v4');
    // chunk starts inside the panel's opening tag and may end inside the next one
    const panel = (panels[i] ?? '').replace(/^[^>]*>/, '').split(/role="tablist"|<hr/i)[0].replace(/<[^>]*$/, '');
    let current: Series | null = null;
    for (const line of htmlToLines(panel)) {
      const lvl = line.match(/^(EP|VP)\b/i);
      if (lvl) {
        current = {
          id: `OLS ${gameType} ${age} (${year}) ${lvl[1].toUpperCase()}`,
          organizer: 'OLS', gender: '', gameType, ageGroup: `${age} (${year})`,
          level: `(${lvl[1].toUpperCase()})`, location, teams: [],
          days: days.map(date => ({ date, kiosk: '' })),
        };
        series.push(current);
        continue;
      }
      if (/ilmoittautuneet/i.test(line) || !current) continue;
      current.teams.push(line);
    }
  });
  if (series.length === 0) warnings.push('OLS: sarjoja/joukkueita ei löytynyt sivulta');

  const pdfLinks = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map(m => m[1]).filter(u => /talviliiga/i.test(u));
  return { season, location, hours, days, series, pdfLinks, warnings };
}

// ─── PDF discovery ────────────────────────────────────────────────────────────

// "Talviliiga221125a.pdf" → 22.11.2025 rev a
export function parsePdfName(url: string): { date: string; revision: number } | null {
  const m = url.match(/talviliiga[-_]?(\d{2})(\d{2})(\d{2})([a-z]*)\.pdf$/i);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = 2000 + +m[3];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const sfx = m[4].toLowerCase();
  const revision = sfx.length === 0 ? 0 : sfx.length === 1 ? sfx.charCodeAt(0) - 96 : 99;
  return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, revision };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function listUploadDir(year: number, month: number): Promise<string[]> {
  const base = `${UPLOADS_BASE}/${year}/${String(month).padStart(2, '0')}/`;
  try {
    const html = await fetchText(base);
    return [...html.matchAll(/href="([^"]+\.pdf)"/gi)]
      .map(m => m[1])
      .filter(u => /talviliiga/i.test(u) && !/kenttakartta/i.test(u))
      .map(u => (u.startsWith('http') ? u : base + u.replace(/^\//, '')));
  } catch {
    return [];
  }
}

// Newest revision per game day, limited to the season's game days
export function pickPdfs(urls: string[], days: string[]): OlsPdf[] {
  const best = new Map<string, OlsPdf>();
  for (const url of new Set(urls)) {
    const p = parsePdfName(url);
    if (!p || (days.length && !days.includes(p.date))) continue;
    const cur = best.get(p.date);
    if (!cur || p.revision > cur.revision) best.set(p.date, { url, ...p });
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ─── PDF parsing ──────────────────────────────────────────────────────────────

interface Item { text: string; x: number; y: number; w: number }

const TIME_RANGE_RE = /^(\d{1,2})[.:]\s*(\d{2})\s*-\s*\d{1,2}[.:]\s*\d{2}$/;
const FIELD_HEADER_RE = /^Kenttä\s*(\d)\s*([A-H])$/i;

async function pdfPages(buf: Uint8Array): Promise<Item[][]> {
  const pdf = await (pdfjsLib as any).getDocument({ data: buf, verbosity: 0 }).promise;
  const pages: Item[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    pages.push((tc.items as any[])
      .filter(i => i.str?.trim())
      .map(i => ({ text: i.str.replace(/\s+/g, ' ').trim(), x: i.transform[4], y: i.transform[5], w: i.width ?? 0 })));
  }
  await pdf.destroy();
  return pages;
}

function groupRows(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - it.y) <= 3) row.push(it);
    else rows.push([it]);
  }
  return rows.map(r => r.sort((a, b) => a.x - b.x));
}

// Maps short PDF names ("Kreikka 17 AEK") to registered names ("OLS Kreikka 17 AEK")
export function makeTeamMatcher(registered: string[]) {
  const norm = (s: string) => teamKey(s)
    .replace(/\b20(\d{2})\b/g, '$1')       // 2017 → 17
    .replace(/^ols\s+/, '')
    .replace(/kreika\b/, 'kreikka');        // typo seen in PDFs
  const byNorm = new Map(registered.map(r => [norm(r), r]));
  const tokens = registered.map(r => ({ name: r, t: new Set(norm(r).split(' ')) }));

  const tokenOk = (t: string, set: Set<string>, fuzzy: boolean) =>
    set.has(t) || (fuzzy && t.length >= 5 && [...set].some(s => s.length >= 5 && editDistance(s, t) <= 2));

  return (short: string): { name: string; matched: boolean } => {
    const n = norm(short);
    const exact = byNorm.get(n);
    if (exact) return { name: exact, matched: true };
    // every token of the short name appears in exactly one registered name ("KKP Oranssi 17" ~ "KKP 2017 Oranssi"),
    // then the same allowing small typos ("Barelona")
    const st = n.split(' ');
    for (const fuzzy of [false, true]) {
      const hits = tokens.filter(c => st.every(t => tokenOk(t, c.t, fuzzy)));
      if (hits.length === 1) return { name: hits[0].name, matched: true };
      if (hits.length > 1) break;
    }
    return { name: short, matched: false };
  };
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function birthYear(name: string): string | null {
  const m = name.match(/\b(?:20)?([12]\d)\b/);
  return m ? `20${m[1]}` : null;
}

export async function parseOlsPdf(
  buf: Uint8Array, opts: { date: string; location: string; series: Series[] },
): Promise<{ games: Game[]; warnings: string[]; documentDate: string | null }> {
  const warnings: string[] = [];
  const games: Game[] = [];
  const registered = opts.series.flatMap(s => s.teams);
  const yearOf = (s: Series) => s.ageGroup.match(/\((\d{4})\)/)?.[1] ?? '';
  const typeByYear = new Map(opts.series.map(s => [yearOf(s), s.gameType] as const));
  // Match within the game's age group first, so "KKP Valkoinen" in a 2018 game
  // doesn't map to a 2020 team of the same name
  const matchers = new Map<string, ReturnType<typeof makeTeamMatcher>>();
  for (const y of typeByYear.keys()) {
    matchers.set(y, makeTeamMatcher(opts.series.filter(s => yearOf(s) === y).flatMap(s => s.teams)));
  }
  const matchAll = makeTeamMatcher(registered);
  const unmatched = new Set<string>();
  let documentDate: string | null = null;

  for (const items of await pdfPages(buf)) {
    const rows = groupRows(items);
    let columns: { name: string; center: number }[] = [];
    let duration = '';

    for (const row of rows) {
      const rowText = row.map(i => i.text).join(' ');

      const dm = rowText.match(/OTTELUOHJELMA\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
      if (dm) documentDate = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;

      const dur = rowText.match(/(\d+)\s*x\s*(\d+)\s*min/i);
      if (dur) duration = `${dur[1] === '1' ? '' : dur[1] + '×'}${dur[2]} min`;

      const headers = row.filter(i => FIELD_HEADER_RE.test(i.text));
      if (headers.length > 0) {
        columns = headers.map(h => {
          const m = h.text.match(FIELD_HEADER_RE)!;
          return { name: `Kenttä ${m[1]}${m[2].toUpperCase()}`, center: h.x + h.w / 2 };
        });
        continue;
      }

      const timeItem = row.find(i => TIME_RANGE_RE.test(i.text));
      if (!timeItem || columns.length === 0) continue;
      const tm = timeItem.text.match(TIME_RANGE_RE)!;
      const time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
      const rowYear = row.find(i => /^20\d{2}$/.test(i.text))?.text ?? '';

      for (const it of row) {
        if (it === timeItem || /^20\d{2}$/.test(it.text) || !it.text.includes('-')) continue;
        const parts = it.text.split(/\s+-\s*|\s*-\s+/).map(s => s.trim()).filter(Boolean);
        if (parts.length !== 2) {
          warnings.push(`${opts.date} ${time}: ottelua ei saatu luettua: "${it.text}"`);
          continue;
        }
        const center = it.x + it.w / 2;
        const col = columns.reduce((a, b) => (Math.abs(b.center - center) < Math.abs(a.center - center) ? b : a));
        const gameYear = birthYear(parts[0]) ?? birthYear(parts[1]) ?? rowYear;
        const match = matchers.get(gameYear) ?? matchAll;
        // Names carrying their own year ("ONS 2017 Punainen") may play in another age group
        const [a, b] = parts.map(s => {
          const r = match(s);
          return r.matched || !birthYear(s) || match === matchAll ? r : matchAll(s);
        });
        for (const t of [a, b]) if (!t.matched) unmatched.add(t.name);
        const gameType = typeByYear.get(gameYear) ?? '';
        games.push({
          date: opts.date, time, field: col.name, location: opts.location,
          gameType, gameDuration: duration, team1: a.name, team2: b.name,
        });
      }
    }
  }

  if (documentDate && documentDate !== opts.date) {
    warnings.push(`PDF:n päivämäärä ${documentDate} ei vastaa tiedostonimeä (${opts.date})`);
  }
  if (registered.length && unmatched.size) {
    warnings.push(`${opts.date}: ${unmatched.size} joukkuetta ei löytynyt ilmoittautuneista: ${[...unmatched].sort().join(', ')}`);
  }
  games.sort((a, b) => a.time.localeCompare(b.time) || a.field.localeCompare(b.field));
  return { games, warnings, documentDate };
}

// ─── Fetch + parse everything ─────────────────────────────────────────────────

export async function refreshOls(previous: OlsData | null): Promise<OlsData> {
  const page = parseOlsPage(await fetchText(OLS_PAGE));

  // Page links + upload dirs for previous/current/next month (PDFs often appear there before the page is updated)
  const now = new Date();
  const months = [-1, 0, 1].map(o => new Date(now.getFullYear(), now.getMonth() + o, 1));
  const dirUrls = (await Promise.all(months.map(d => listUploadDir(d.getFullYear(), d.getMonth() + 1)))).flat();
  const pdfs = pickPdfs([...page.pdfLinks, ...dirUrls], page.days);

  const warnings = [...page.warnings];
  for (const pdf of pdfs) {
    const prev = previous?.pdfs.find(p => p.url === pdf.url);
    try {
      const res = await fetch(pdf.url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      pdf.hash = createHash('sha256').update(buf).digest('hex');
      if (prev?.hash === pdf.hash && prev.parserVersion === OLS_PARSER_VERSION && prev.games) {
        pdf.games = prev.games;
        pdf.warnings = prev.warnings;
      } else {
        const r = await parseOlsPdf(buf, { date: pdf.date, location: page.location, series: page.series });
        pdf.games = r.games;
        pdf.warnings = r.warnings;
        console.log(`OLS PDF ${pdf.url}: ${r.games.length} games`);
      }
      pdf.parserVersion = OLS_PARSER_VERSION;
    } catch (e) {
      if (prev?.games) Object.assign(pdf, { hash: prev.hash, games: prev.games, warnings: prev.warnings, parserVersion: prev.parserVersion });
      warnings.push(`OLS PDF ${pdf.url}: ${e}`);
    }
    warnings.push(...(pdf.warnings ?? []));
  }

  const games = pdfs.flatMap(p => p.games ?? []);
  const days = buildDays(page.series, games, warnings);
  return {
    parserVersion: OLS_PARSER_VERSION,
    lastUpdated: new Date().toISOString(),
    sourceUrl: OLS_PAGE,
    season: page.season,
    games,
    series: page.series,
    days,
    warnings: [...new Set(warnings)],
    pdfs,
  };
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (arg?.endsWith('.pdf')) {
    const page = parseOlsPage(await Bun.file(process.argv[3] ?? 'test/fixtures/ols-talviliiga-2026-11-15.html').text());
    const info = parsePdfName(arg);
    const r = await parseOlsPdf(new Uint8Array(await Bun.file(arg).arrayBuffer()),
      { date: info?.date ?? '', location: page.location, series: page.series });
    for (const g of r.games) console.log(g.time, g.field.padEnd(10), g.gameType, g.gameDuration.padEnd(7), g.team1, '–', g.team2);
    console.log(`${r.games.length} games`);
    r.warnings.forEach(w => console.warn('! ' + w));
  } else {
    const d = await refreshOls(null);
    console.log(`OLS ${d.season}: ${d.series.length} series, days ${d.days.map(x => x.date).join(', ')}`);
    console.log(`PDFs: ${d.pdfs.map(p => `${p.url} (${p.games?.length ?? 0})`).join(', ') || 'none yet'}`);
    d.warnings.forEach(w => console.warn('! ' + w));
  }
}
