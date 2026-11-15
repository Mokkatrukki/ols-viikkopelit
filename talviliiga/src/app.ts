import * as path from 'path';
import * as fs from 'fs';
import ejs from 'ejs';
import { fetchSheet, SHEET_URL } from './fetcher.ts';
import { parseWorkbook, teamKey, PARSER_VERSION } from './parser.ts';
import type { Game, GamesData, Series, TournamentDay } from './parser.ts';

const ROOT = path.join(import.meta.dir, '..');
const DATA_PATH = path.join(ROOT, 'data/games.json');
const STATS_PATH = path.join(ROOT, 'data/stats.json');
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3003;
// Data is refreshed lazily: a request arriving after this long triggers a background fetch
const REFRESH_INTERVAL_MS = (parseInt(process.env.REFRESH_MINUTES ?? '') || 15) * 60_000;

// ─── Date helpers (Finnish time) ──────────────────────────────────────────────

const WEEKDAYS = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];

function todayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
}

function formatDate(iso: string, weekday = true): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday ? wd + ' ' : ''}${d}.${m}.${y}`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}.${m}.`;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function toTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function durationMin(g: Game): number {
  return parseInt(g.gameDuration) || 0;
}

function seriesShort(s: Series): string {
  const lvl = s.level.match(/\((\w+)\)/)?.[1] ?? '';
  return [s.ageGroup.replace(/\s*\(/, ' ('), lvl].filter(Boolean).join(' ');
}

// ─── Team grouping (same dynamic algorithm as ols-viikkopelitv2) ──────────────

interface BaseTeam { name: string; subteams: string[] }

function longestCommonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const prefix = a.substring(0, i);
  const lastSpace = prefix.lastIndexOf(' ');
  return lastSpace > 0 ? prefix.substring(0, lastSpace).trim() : prefix.trim();
}

function findTeamGroups(names: string[]): Map<string, string[]> {
  const candidates: { prefix: string; teams: string[] }[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const prefix = longestCommonPrefix(names[i], names[j]);
      const words = prefix.split(/\s+/).filter(w => w.length > 0);
      const meaningful =
        (prefix.length >= 10 && words.length >= 3) ||
        (words.length >= 2 && words.every(w => w.length >= 2)) ||
        (words.length === 1 && prefix.length >= 3);
      if (!meaningful) continue;
      const matching = names.filter(n => n.startsWith(prefix + ' '));
      if (matching.length >= 2) candidates.push({ prefix, teams: matching.sort() });
    }
  }

  const unique: { prefix: string; teams: string[] }[] = [];
  for (const c of candidates) {
    const ts = new Set(c.teams);
    const idx = unique.findIndex(u => u.teams.length === ts.size && u.teams.every(t => ts.has(t)));
    if (idx === -1) unique.push(c);
    else if (c.prefix.length > unique[idx].prefix.length) unique[idx] = c;
  }
  unique.sort((a, b) => b.prefix.length - a.prefix.length || b.teams.length - a.teams.length);

  const result = new Map<string, string[]>();
  const used = new Set<string>();
  for (const g of unique) {
    if (g.teams.some(t => used.has(t))) continue;
    result.set(g.prefix, g.teams);
    g.teams.forEach(t => used.add(t));
  }
  return result;
}

// ─── Data store ───────────────────────────────────────────────────────────────

interface TeamInfo { name: string; series: Series[] }

let gamesData: GamesData | null = null;
let teams = new Map<string, TeamInfo>();          // teamKey → info
let baseTeams: BaseTeam[] = [];
let individualTeams: string[] = [];
let lastRefreshAttempt = 0;
let refreshInFlight: Promise<{ ok: boolean; message: string }> | null = null;

function indexData(data: GamesData) {
  teams = new Map();
  const add = (name: string, s?: Series) => {
    const k = teamKey(name);
    let t = teams.get(k);
    if (!t) { t = { name, series: [] }; teams.set(k, t); }
    if (s && !t.series.includes(s)) t.series.push(s);
  };
  for (const s of data.series) s.teams.forEach(n => add(n, s));
  for (const g of data.games) { add(g.team1); add(g.team2); }

  const names = [...teams.values()].map(t => t.name);
  const groups = findTeamGroups(names);
  const grouped = new Set([...groups.values()].flat());
  baseTeams = [...groups.entries()].map(([name, subteams]) => ({ name, subteams }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  individualTeams = names.filter(n => !grouped.has(n)).sort((a, b) => a.localeCompare(b, 'fi'));
}

function setData(data: GamesData) {
  gamesData = data;
  indexData(data);
}

async function loadData(): Promise<void> {
  try {
    const f = Bun.file(DATA_PATH);
    if (!(await f.exists())) return;
    setData(await f.json() as GamesData);
    console.log(`Loaded ${gamesData!.games.length} games, ${gamesData!.days.length} days`);
  } catch (e) {
    console.error('Failed to load data:', e);
  }
}

async function doRefresh(): Promise<{ ok: boolean; message: string }> {
  lastRefreshAttempt = Date.now();
  try {
    const sheet = await fetchSheet();
    if (gamesData?.sourceHash === sheet.hash && gamesData.parserVersion === PARSER_VERSION) {
      gamesData.lastUpdated = new Date().toISOString();
      fs.writeFileSync(DATA_PATH, JSON.stringify(gamesData, null, 2));
      return { ok: true, message: 'Ei muutoksia' };
    }
    const data = parseWorkbook(sheet.buffer, sheet.url);
    data.sourceHash = sheet.hash;
    if (data.series.length === 0 && gamesData && gamesData.series.length > 0) {
      // Don't wipe good data with a broken parse
      return { ok: false, message: 'Parsinta ei löytänyt sarjoja – vanha data säilytetty. ' + data.warnings.join('; ') };
    }
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    setData(data);
    const msg = `Päivitetty: ${data.games.length} peliä, ${data.days.length} pelipäivää`;
    console.log(msg);
    return { ok: true, message: msg };
  } catch (e) {
    console.error('Refresh failed:', e);
    return { ok: false, message: String(e) };
  }
}

function refreshData(): Promise<{ ok: boolean; message: string }> {
  refreshInFlight ??= doRefresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function maybeRefreshInBackground() {
  if (refreshInFlight || Date.now() - lastRefreshAttempt < REFRESH_INTERVAL_MS) return;
  const age = gamesData ? Date.now() - new Date(gamesData.lastUpdated).getTime() : Infinity;
  if (age >= REFRESH_INTERVAL_MS) void refreshData();
}

// ─── Visitor tracking (same as ols-viikkopelitv2) ─────────────────────────────

interface Stats { dailyVisits: Record<string, number>; dailyUnique: Record<string, string[]> }
let stats: Stats = { dailyVisits: {}, dailyUnique: {} };

function loadStats() {
  try {
    if (fs.existsSync(STATS_PATH)) {
      stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
      stats.dailyVisits ??= {};
      stats.dailyUnique ??= {};
    }
  } catch { stats = { dailyVisits: {}, dailyUnique: {} }; }
}

function recordVisit(sid: string) {
  const key = todayIso();
  stats.dailyVisits[key] = (stats.dailyVisits[key] ?? 0) + 1;
  (stats.dailyUnique[key] ??= []);
  if (!stats.dailyUnique[key].includes(sid)) stats.dailyUnique[key].push(sid);
  try {
    fs.mkdirSync(path.dirname(STATS_PATH), { recursive: true });
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats));
  } catch { }
}

// ─── Field maps ───────────────────────────────────────────────────────────────

const fieldMapData: Record<string, { src: string; width: number; height: number }> = {
  'KEMPELE AREENA KENTTÄ 1': { src: '/images/kempele-kentta-1.webp', width: 1000, height: 707 },
  'KEMPELE AREENA KENTTÄ 2': { src: '/images/kempele-kentta-2.webp', width: 1000, height: 707 },
  'KEMPELE AREENA KENTTÄ 3': { src: '/images/kempele-kentta-3.webp', width: 1000, height: 707 },
  'KEMPELE AREENA KENTTÄ 4': { src: '/images/kempele-kentta-4.webp', width: 1000, height: 707 },
};

function fieldMap(g: Game) {
  return fieldMapData[`${g.location} ${g.field}`.toUpperCase().replace(/\s+/g, ' ')] ?? null;
}

// ─── View models ──────────────────────────────────────────────────────────────

interface DaySection {
  date: string;
  dateLabel: string;
  location: string;
  gameType: string;
  series: string[];
  kiosk: string;
  published: boolean;     // schedule for that day exists in the sheet
  games: (Game & { opponent: string; breakMin?: number; map: ReturnType<typeof fieldMap> })[];
  firstTime: string | null;
  lastEnd: string | null;
}

function findDay(date: string, gameType: string): TournamentDay | undefined {
  return gamesData?.days.find(d => d.date === date && d.gameType === gameType);
}

function teamSections(teamName: string, includePast: boolean): DaySection[] {
  if (!gamesData) return [];
  const info = teams.get(teamKey(teamName));
  const today = todayIso();
  const k = teamKey(teamName);
  const sections = new Map<string, DaySection>();

  const ensure = (date: string, gameType: string, location: string, seriesId?: string, kiosk = '') => {
    const key = `${date}|${gameType}`;
    let s = sections.get(key);
    if (!s) {
      const day = findDay(date, gameType);
      s = {
        date, dateLabel: formatDate(date), location: location || day?.location || '', gameType,
        series: [], kiosk, published: (day?.gamesPublished ?? 0) > 0, games: [], firstTime: null, lastEnd: null,
      };
      sections.set(key, s);
    }
    if (seriesId && !s.series.includes(seriesId)) s.series.push(seriesId);
    if (kiosk && !s.kiosk) s.kiosk = kiosk;
    return s;
  };

  for (const s of info?.series ?? []) {
    for (const d of s.days) ensure(d.date, s.gameType, s.location, seriesShort(s), d.kiosk);
  }
  for (const g of gamesData.games) {
    if (teamKey(g.team1) !== k && teamKey(g.team2) !== k) continue;
    const sec = ensure(g.date, g.gameType, g.location);
    sec.games.push({ ...g, opponent: teamKey(g.team1) === k ? g.team2 : g.team1, map: fieldMap(g) });
  }

  for (const s of sections.values()) {
    s.games.sort((a, b) => a.time.localeCompare(b.time));
    for (let i = 1; i < s.games.length; i++) {
      const prev = s.games[i - 1], cur = s.games[i];
      const brk = toMinutes(cur.time) - toMinutes(prev.time) - durationMin(prev);
      if (durationMin(prev) && brk > 0) cur.breakMin = brk;
    }
    if (s.games.length) {
      s.firstTime = s.games[0].time;
      const last = s.games[s.games.length - 1];
      s.lastEnd = durationMin(last) ? toTime(toMinutes(last.time) + durationMin(last)) : null;
    }
  }

  return [...sections.values()]
    .filter(s => includePast || s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function upcomingDays() {
  if (!gamesData) return [];
  const today = todayIso();
  const byId = new Map(gamesData.series.map(s => [s.id, s]));
  return gamesData.days
    .filter(d => d.date >= today)
    .map(d => ({
      ...d,
      dateLabel: formatDate(d.date),
      seriesLabels: d.series.map(id => byId.get(id)).filter((s): s is Series => !!s).map(seriesShort),
      isToday: d.date === today,
    }));
}

// ─── Rendering ────────────────────────────────────────────────────────────────

async function render(template: string, data: Record<string, unknown>, req: Request, status = 200): Promise<Response> {
  const html = await ejs.renderFile(path.join(ROOT, 'views', template), { formatDate, shortDate, ...data });
  const headers: Record<string, string> = { 'Content-Type': 'text/html; charset=utf-8' };
  if ((req.headers.get('accept-encoding') ?? '').includes('gzip')) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    return new Response(Bun.gzipSync(Buffer.from(html, 'utf-8')), { status, headers });
  }
  return new Response(html, { status, headers });
}

function getBaseUrl(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function commonVars(baseUrl: string) {
  return {
    season: gamesData?.season ?? '',
    baseTeams,
    individualTeams,
    selectedTeam: null as string | null,
    hasData: !!gamesData,
    lastUpdated: gamesData?.lastUpdated ?? null,
    sheetUrl: SHEET_URL,
    metaUrl: baseUrl,
  };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleHome(req: Request): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  const days = upcomingDays();
  const next = days[0];
  const title = gamesData?.season ? `Talviliiga ${gamesData.season}` : 'Talviliiga';
  return render('index.ejs', {
    ...commonVars(baseUrl),
    documentTitle: title,
    metaTitle: title,
    metaDescription: next
      ? `Seuraava turnauspäivä ${next.dateLabel} ${next.location} (${next.gameType})`
      : 'Talviliigan 4v4- ja 5v5-turnausten otteluohjelmat',
    upcomingDays: days,
    sections: [],
  }, req);
}

async function handleTeam(req: Request, teamName: string, url: URL): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  const info = teams.get(teamKey(teamName));
  if (!info) {
    return render('index.ejs', {
      ...commonVars(baseUrl), documentTitle: 'Joukkuetta ei löytynyt - Talviliiga',
      metaTitle: 'Talviliiga', metaDescription: '', upcomingDays: upcomingDays(), sections: [],
      notFound: teamName,
    }, req, 404);
  }
  const includePast = url.searchParams.has('menneet');
  const sections = teamSections(info.name, includePast);
  const parent = baseTeams.find(bt => bt.subteams.includes(info.name)) ?? null;
  const next = sections[0];
  const metaDescription = next
    ? next.games.length
      ? `${next.dateLabel}: eka peli ${next.firstTime}, ${next.location}`
      : `Seuraava pelipäivä ${next.dateLabel}, ${next.location}`
    : `${info.name} – Talviliigan otteluohjelma`;

  return render('index.ejs', {
    ...commonVars(`${baseUrl}/team/${encodeURIComponent(info.name)}`),
    documentTitle: `${info.name} - Talviliiga`,
    metaTitle: `${info.name} - Talviliiga`,
    metaDescription,
    selectedTeam: info.name,
    teamSeries: info.series.map(seriesShort),
    teamParent: parent ? { name: parent.name, suffix: info.name.substring(parent.name.length).trim() } : null,
    sections,
    includePast,
    upcomingDays: [],
  }, req);
}

async function handleBaseTeam(req: Request, name: string): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  const bt = baseTeams.find(b => b.name === name);
  if (!bt) return new Response('Not found', { status: 404 });

  const subteams = bt.subteams.map(sub => {
    const next = teamSections(sub, false)[0] ?? null;
    return { name: sub, suffix: sub.substring(bt.name.length).trim(), next };
  });
  const nextDate = subteams.map(s => s.next?.date).filter(Boolean).sort()[0] ?? null;
  const onNext = subteams.filter(s => s.next?.date === nextDate && s.next.games.length);
  const first = onNext.map(s => s.next!.firstTime!).sort()[0] ?? null;
  const lastEnd = onNext.map(s => s.next!.lastEnd).filter(Boolean).sort().pop() ?? null;
  const times = onNext.map(s => `${s.suffix} ${s.next!.firstTime}`).join(', ');

  return render('base_team_portal.ejs', {
    documentTitle: `${bt.name} - Talviliiga`,
    metaTitle: nextDate ? `${bt.name} - ${formatDate(nextDate)} - Talviliiga` : `${bt.name} - Talviliiga`,
    metaDescription: [first && lastEnd ? `${first}–${lastEnd}` : null, times].filter(Boolean).join(' | '),
    metaUrl: `${baseUrl}/base-team/${encodeURIComponent(bt.name)}`,
    baseTeamName: bt.name,
    subteams,
    nextDate: nextDate ? formatDate(nextDate) : null,
    firstGameTime: first,
    lastGameEndTime: lastEnd,
    lastUpdated: gamesData?.lastUpdated ?? null,
  }, req);
}

async function handleAdmin(req: Request): Promise<Response> {
  const today = todayIso();
  const dailyStats = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const key = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(d);
    return { date: key, visits: stats.dailyVisits[key] ?? 0, unique: stats.dailyUnique[key]?.length ?? 0 };
  });
  return render('admin.ejs', {
    documentTitle: 'Admin - Talviliiga',
    lastUpdated: gamesData?.lastUpdated ?? null,
    sheetUrl: SHEET_URL,
    season: gamesData?.season ?? '',
    gamesCount: gamesData?.games.length ?? 0,
    seriesCount: gamesData?.series.length ?? 0,
    teamsCount: teams.size,
    days: (gamesData?.days ?? []).map(d => ({ ...d, dateLabel: formatDate(d.date), past: d.date < today })),
    warnings: gamesData?.warnings ?? [],
    dailyStats,
    todayVisits: stats.dailyVisits[today] ?? 0,
    todayUnique: stats.dailyUnique[today]?.length ?? 0,
  }, req);
}

async function handleStatic(pathname: string): Promise<Response> {
  const rel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = Bun.file(path.join(ROOT, 'public', rel));
  if (!(await file.exists())) return new Response('Not Found', { status: 404 });
  const isImage = pathname.startsWith('/images/');
  return new Response(file, { headers: { 'Cache-Control': `public, max-age=${isImage ? 2592000 : 86400}` } });
}

// ─── Server ───────────────────────────────────────────────────────────────────

const startTime = Date.now();
console.log('Starting Talviliiga v2...');
loadStats();
await loadData();
if (!gamesData) await refreshData();   // first boot: block until we have something to show
else maybeRefreshInBackground();

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  maxRequestBodySize: 1024 * 64,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/health') return Response.json({ status: 'UP', games: gamesData?.games.length ?? 0 });
    if (p.startsWith('/images/') || p.startsWith('/css/') || p === '/favicon.ico') return handleStatic(p);

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    console.log(`${req.method} ${p} - ${ip}`);

    if (p === '/api/refresh' && (req.method === 'POST' || req.method === 'GET')) {
      const result = await refreshData();
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }
    if (p === '/admin') return handleAdmin(req);

    maybeRefreshInBackground();

    const cookie = req.headers.get('cookie') ?? '';
    let sid = decodeURIComponent(cookie.match(/(?:^|;\s*)hb_sid=([^;]+)/)?.[1] ?? '');
    const isNewSid = sid.length < 8;
    if (isNewSid) sid = crypto.randomUUID();

    let res: Response;
    const teamM = p.match(/^\/team\/(.+)$/);
    const baseM = p.match(/^\/base-team\/(.+)$/);
    if (p === '/') res = await handleHome(req);
    else if (teamM) res = await handleTeam(req, decodeURIComponent(teamM[1]), url);
    else if (baseM) res = await handleBaseTeam(req, decodeURIComponent(baseM[1]));
    else if (p.startsWith('/date/')) res = new Response(null, { status: 302, headers: { Location: '/' } });
    else res = new Response('Not Found', { status: 404 });

    if (res.status === 200 && res.headers.get('content-type')?.includes('text/html')) {
      recordVisit(sid);
      if (isNewSid) res.headers.set('Set-Cookie', `hb_sid=${encodeURIComponent(sid)}; Path=/; Max-Age=31536000; SameSite=Lax`);
    }
    return res;
  },
  error(err) {
    console.error('Unhandled server error:', err);
    return new Response('Internal Server Error', { status: 500 });
  },
});

console.log(`Server running at http://localhost:${PORT} (startup: ${Date.now() - startTime}ms)`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    console.log(`${sig} received, shutting down...`);
    await server.stop(true);
    process.exit(0);
  });
}
