import * as path from 'path';
import * as fs from 'fs';
import ejs from 'ejs';
import { fetchLatestPdf } from './fetcher.ts';
import { parsePdf } from './parser.ts';
import type { Game, DateGroup, GamesData } from './parser.ts';

const ROOT = path.join(import.meta.dir, '..');
const DATA_PATH = path.join(ROOT, 'data/games.json');
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3003;

// ─── Team grouping (same dynamic algorithm as talviliiga) ─────────────────────

interface BaseTeam {
  name: string;
  subteams: string[];
}

interface GroupedTeamEntry {
  year: string;
  teams: string[];
  baseTeams: BaseTeam[];
  individualTeams: string[];
}

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

  // Deduplicate - keep longer prefix for same team set
  const unique: { prefix: string; teams: string[] }[] = [];
  for (const c of candidates) {
    const ts = new Set(c.teams);
    const existingIdx = unique.findIndex(u => {
      const us = new Set(u.teams);
      return ts.size === us.size && [...ts].every(t => us.has(t));
    });
    if (existingIdx === -1) {
      unique.push(c);
    } else if (c.prefix.length > unique[existingIdx].prefix.length) {
      unique[existingIdx] = c;
    }
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

function buildGroupedTeams(games: Game[]): GroupedTeamEntry[] {
  const names = [...new Set([...games.map(g => g.team1), ...games.map(g => g.team2)].filter(Boolean))];
  const groups = findTeamGroups(names);
  const allSubteams = new Set([...groups.values()].flat());

  const baseTeams: BaseTeam[] = [...groups.entries()].map(([name, subteams]) => ({ name, subteams }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const individualTeams = names.filter(n => !allSubteams.has(n)).sort();

  return [{ year: '', teams: names.sort(), baseTeams, individualTeams }];
}


function splitTeamName(name: string, baseTeams: BaseTeam[]): { parent: string | null; subteam: string | null; fullName: string } {
  for (const bt of baseTeams) {
    if (bt.subteams.includes(name)) {
      return { parent: bt.name, subteam: name.substring(bt.name.length).trim(), fullName: name };
    }
  }
  return { parent: null, subteam: null, fullName: name };
}


function parseTimeToMinutes(s: string): number {
  const p = s.split(':');
  if (p.length !== 2) return NaN;
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

function parseDurationMinutes(dur: string): number {
  const m = dur.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// ─── Field map data ───────────────────────────────────────────────────────────

const fieldMapData: Record<string, { src: string; width: number; height: number }> = {
  'PÖRHÖ AREENA 1A': { src: '/images/garam_masala_map_kentta_1a.png', width: 672, height: 1010 },
  'PÖRHÖ AREENA 1B': { src: '/images/garam_masala_map_kentta_1b.png', width: 672, height: 1010 },
  'PÖRHÖ AREENA 1C': { src: '/images/garam_masala_map_kentta_1c.png', width: 672, height: 1010 },
  'PÖRHÖ AREENA 1D': { src: '/images/garam_masala_map_kentta_1d.png', width: 672, height: 1010 },
  'PÖRHÖ AREENA 2A': { src: '/images/garam_masala_map_kentta_2a.png', width: 672, height: 1010 },
  'PÖRHÖ AREENA 2B': { src: '/images/garam_masala_map_kentta_2b.png', width: 672, height: 1010 },
  'PÖRHÖ AREENA 2C': { src: '/images/garam_masala_map_kentta_2c.png', width: 672, height: 1010 },
  'PÖRHÖ AREENA 2D': { src: '/images/garam_masala_map_kentta_2d.png', width: 672, height: 1010 },
  'HEINÄPÄÄN TEKONURMI A': { src: '/images/tekonurmi_map_kentta_a.png', width: 672, height: 1010 },
  'HEINÄPÄÄN TEKONURMI B': { src: '/images/tekonurmi_map_kentta_b.png', width: 672, height: 1010 },
  'HEINÄPÄÄN TEKONURMI C': { src: '/images/tekonurmi_map_kentta_c.png', width: 672, height: 1010 },
  'HEINÄPÄÄN TEKONURMI D': { src: '/images/tekonurmi_map_kentta_d.png', width: 672, height: 1010 },
  'HEPA - HALLI A': { src: '/images/heinapaan_halli_map_kentta_a.png', width: 672, height: 444 },
  'HEPA - HALLI B': { src: '/images/heinapaan_halli_map_kentta_b.png', width: 672, height: 444 },
  'HEPA - HALLI C': { src: '/images/heinapaan_halli_map_kentta_c.png', width: 672, height: 444 },
  'HEPA - HALLI D': { src: '/images/heinapaan_halli_map_kentta_d.png', width: 672, height: 444 },
};

// ─── Active user tracking ─────────────────────────────────────────────────────

const activeSessions = new Map<string, number>(); // sessionId → lastSeen ms
const SESSION_TTL = 60_000; // 60s

const STATS_PATH = path.join(ROOT, 'data/stats.json');
interface Stats {
  dailyMaxUsers: Record<string, number>; // "YYYY-MM-DD" → max active users that day
}
let stats: Stats = { dailyMaxUsers: {} };

function loadStats() {
  try {
    if (fs.existsSync(STATS_PATH)) {
      stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
      stats.dailyMaxUsers ??= {};
    }
  } catch { stats = { dailyMaxUsers: {} }; }
}

function saveStats() {
  try { fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2)); } catch { }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function pruneOldSessions() {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [id, ts] of activeSessions) {
    if (ts < cutoff) activeSessions.delete(id);
  }
}

function activeUserCount(): number {
  pruneOldSessions();
  return activeSessions.size;
}

function updateDailyMax(count: number) {
  const key = todayKey();
  if ((stats.dailyMaxUsers[key] ?? 0) < count) {
    stats.dailyMaxUsers[key] = count;
    saveStats();
  }
}

function handleHeartbeat(req: Request): Response {
  const url = new URL(req.url);
  let sid = url.searchParams.get('sid') ?? '';
  if (!sid || sid.length < 8) sid = Math.random().toString(36).slice(2);
  activeSessions.set(sid, Date.now());
  const active = activeUserCount();
  updateDailyMax(active);
  return Response.json({ sid, active });
}

// ─── Data store ───────────────────────────────────────────────────────────────

let gamesData: GamesData | null = null;
let cachedGroupedTeams: GroupedTeamEntry[] = [];
let cachedBaseTeams: BaseTeam[] = [];

async function loadData(): Promise<void> {
  try {
    const f = Bun.file(DATA_PATH);
    if (!(await f.exists())) return;
    gamesData = await f.json() as GamesData;
    cachedGroupedTeams = buildGroupedTeams(gamesData.games);
    cachedBaseTeams = cachedGroupedTeams[0]?.baseTeams ?? [];
    console.log(`Loaded ${gamesData.games.length} games, ${gamesData.gamesByDate.length} dates`);
  } catch (e) {
    console.error('Failed to load data:', e);
    gamesData = null;
  }
}

async function refreshData(): Promise<{ ok: boolean; message: string }> {
  try {
    const pdf = await fetchLatestPdf();
    if (!pdf) return { ok: false, message: 'No PDF found on OLS website' };

    // Skip re-parsing only if URL AND hash both match
    const sameUrl = gamesData?.pdfUrl === pdf.url;
    const sameHash = gamesData?.pdfHash && gamesData.pdfHash === pdf.hash;
    if (sameUrl && sameHash && gamesData!.games.length > 0) {
      return { ok: true, message: `Already up to date (${pdf.url})` };
    }

    const data = await parsePdf(pdf.localPath, pdf.url);
    data.pdfHash = pdf.hash;
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    gamesData = data;
    cachedGroupedTeams = buildGroupedTeams(data.games);
    cachedBaseTeams = cachedGroupedTeams[0]?.baseTeams ?? [];

    return { ok: true, message: `Updated: ${data.games.length} games from ${pdf.url}` };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

async function render(template: string, data: Record<string, unknown>, req: Request): Promise<Response> {
  const html = await ejs.renderFile(path.join(ROOT, 'views', template), data);
  const ae = req.headers.get('accept-encoding') ?? '';
  if (ae.includes('gzip')) {
    const compressed = Bun.gzipSync(Buffer.from(html, 'utf-8'));
    return new Response(compressed, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Encoding': 'gzip',
        'Vary': 'Accept-Encoding',
      },
    });
  }
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function getBaseUrl(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3003';
  return `${proto}://${host}`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function makeIndexVars(baseUrl: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const documentDate = gamesData?.documentDate ?? '';
  const title = documentDate ? `OLS Viikkopelit - ${documentDate}` : 'OLS Viikkopelit';
  return {
    documentTitle: title,
    metaTitle: title,
    metaDescription: 'OLS:n viikkopelien otteluohjelma',
    metaUrl: baseUrl,
    documentDate,
    groupedTeams: cachedGroupedTeams,
    selectedTeam: null,
    teamNameSplit: null,
    gamesForTeam: [],
    fieldMapData,
    hasData: !!gamesData && gamesData.games.length > 0,
    lastUpdated: gamesData?.lastUpdated ?? null,
    pdfUrl: gamesData?.pdfUrl ?? null,
    ...extra,
  };
}

async function handleHome(req: Request): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  return render('index.ejs', makeIndexVars(baseUrl), req);
}

async function handleTeam(req: Request, teamName: string): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  const games = gamesData?.games ?? [];
  const gamesByDate = gamesData?.gamesByDate ?? [];

  const gamesForTeam = games
    .filter(g => g.team1 === teamName || g.team2 === teamName)
    .map(g => {
      const opponent = g.team1 === teamName ? g.team2 : g.team1;
      const dg = gamesByDate.find(d => d.date === g.date);
      return { ...g, opponent: opponent || '?', fullDate: dg?.fullDate ?? g.date };
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });

  for (let i = 1; i < gamesForTeam.length; i++) {
    const cur = gamesForTeam[i] as any;
    const prev = gamesForTeam[i - 1];
    if (cur.date !== prev.date) continue;
    const durationMin = parseInt(prev.gameDuration) || 0;
    if (!durationMin) continue;
    const breakMin = parseTimeToMinutes(cur.time) - parseTimeToMinutes(prev.time) - durationMin;
    if (breakMin > 0) cur.breakDurationMinutes = breakMin;
  }

  const teamNameSplit = splitTeamName(teamName, cachedBaseTeams);
  const firstGame = gamesForTeam[0];
  const metaDescription = firstGame
    ? `Eka peli: ${firstGame.time}${firstGame.location ? ', ' + firstGame.location : ''}`
    : `${teamName} otteluohjelma`;

  let metaTitle = teamNameSplit.parent && teamNameSplit.subteam
    ? `${teamNameSplit.parent} ${teamNameSplit.subteam}`
    : teamName;
  metaTitle += ' - OLS Viikkopelit';

  return render('index.ejs', makeIndexVars(`${baseUrl}/team/${encodeURIComponent(teamName)}`, {
    metaTitle,
    metaDescription,
    metaUrl: `${baseUrl}/team/${encodeURIComponent(teamName)}`,
    selectedTeam: teamName,
    teamNameSplit,
    gamesForTeam,
  }), req);
}

async function handleBaseTeam(req: Request, baseTeamName: string): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  const games = gamesData?.games ?? [];
  const gamesByDate = gamesData?.gamesByDate ?? [];
  const baseTeam = cachedBaseTeams.find(bt => bt.name === baseTeamName);

  if (!baseTeam) return new Response('Not found', { status: 404 });

  const subteamsWithNextGame = baseTeam.subteams.map(name => {
    const subGames = games
      .filter(g => g.team1 === name || g.team2 === name)
      .map(g => {
        const dg = gamesByDate.find(d => d.date === g.date);
        return { ...g, opponent: g.team1 === name ? g.team2 : g.team1, fullDate: dg?.fullDate ?? g.date };
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
      });

    const firstGame = subGames[0] ?? null;
    const nextDate = firstGame?.date ?? '';
    const gamesOnDate = nextDate ? subGames.filter(g => g.date === nextDate) : subGames;

    let subLastEndTime: string | null = null;
    if (gamesOnDate.length > 0) {
      const endMins = gamesOnDate.map(g => {
        const s = parseTimeToMinutes(g.time);
        return isNaN(s) ? NaN : s + parseDurationMinutes(g.gameDuration);
      }).filter(t => !isNaN(t));
      if (endMins.length > 0) subLastEndTime = minutesToTime(Math.max(...endMins));
    }

    return { name, nextGame: firstGame, lastEndTime: subLastEndTime, location: firstGame?.location ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const nextDate = subteamsWithNextGame.find(s => s.nextGame)?.nextGame?.date ?? '';

  // Compute first game start and last game end across all subteams on next game date
  const allSubteamGames = baseTeam.subteams.flatMap(name =>
    games.filter(g => (g.team1 === name || g.team2 === name) && (!nextDate || g.date === nextDate))
  );

  let firstGameTime: string | null = null;
  let lastGameEndTime: string | null = null;

  if (allSubteamGames.length > 0) {
    const startMins = allSubteamGames.map(g => parseTimeToMinutes(g.time)).filter(t => !isNaN(t));
    const endMins = allSubteamGames.map(g => {
      const s = parseTimeToMinutes(g.time);
      return isNaN(s) ? NaN : s + parseDurationMinutes(g.gameDuration);
    }).filter(t => !isNaN(t));

    if (startMins.length > 0) firstGameTime = minutesToTime(Math.min(...startMins));
    if (endMins.length > 0) lastGameEndTime = minutesToTime(Math.max(...endMins));
  }

  const metaTitle = nextDate
    ? `${baseTeamName} - ${nextDate} - OLS Viikkopelit`
    : `${baseTeamName} - OLS Viikkopelit`;

  const teamTimes = subteamsWithNextGame
    .map(s => {
      const short = s.name.split(' ').pop();
      return s.nextGame ? `${short} ${s.nextGame.time}` : null;
    })
    .filter(Boolean)
    .join(', ');

  const timeRange = firstGameTime && lastGameEndTime
    ? `${firstGameTime}–${lastGameEndTime}`
    : null;

  const metaDescription = [timeRange, teamTimes].filter(Boolean).join(' | ');

  return render('base_team_portal.ejs', {
    documentTitle: `${baseTeamName} - Joukkueportaali`,
    metaTitle,
    metaDescription,
    metaUrl: `${baseUrl}/base-team/${encodeURIComponent(baseTeamName)}`,
    baseTeamName,
    subteams: subteamsWithNextGame,
    firstGameTime,
    lastGameEndTime,
    nextDate,
    fieldMapData,
    lastUpdated: gamesData?.lastUpdated ?? null,
  }, req);
}

async function handleAdmin(req: Request): Promise<Response> {
  // Last 30 days sorted ascending
  const today = todayKey();
  const dailyStats = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const key = d.toISOString().slice(0, 10);
    return { date: key, max: stats.dailyMaxUsers[key] ?? 0 };
  });
  return render('admin.ejs', {
    documentTitle: 'Admin - OLS Viikkopelit',
    lastUpdated: gamesData?.lastUpdated ?? null,
    pdfUrl: gamesData?.pdfUrl ?? null,
    gamesCount: gamesData?.games.length ?? 0,
    datesCount: gamesData?.gamesByDate.length ?? 0,
    dailyStats,
    todayMax: stats.dailyMaxUsers[today] ?? 0,
  }, req);
}

async function handleRefresh(): Promise<Response> {
  const result = await refreshData();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

async function handleStatic(pathname: string): Promise<Response> {
  const file = Bun.file(path.join(ROOT, 'public', pathname));
  if (await file.exists()) {
    const isImage = pathname.startsWith('/images/');
    return new Response(file, {
      headers: { 'Cache-Control': isImage ? 'public, max-age=2592000' : 'public, max-age=86400' },
    });
  }
  return new Response('Not Found', { status: 404 });
}

// ─── Server ───────────────────────────────────────────────────────────────────

const startTime = Date.now();
console.log('Starting OLS Viikkopelit v2...');
loadStats();
await loadData();

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  maxRequestBodySize: 1024 * 1024 * 2, // 2 MB
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    // Log requests (skip static)
    if (!p.startsWith('/css') && !p.startsWith('/images') && p !== '/health' && p !== '/favicon.ico') {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
      console.log(`${req.method} ${p} - ${ip}`);
    }

    if (p === '/health') return Response.json({ status: 'UP', games: gamesData?.games.length ?? 0, active: activeUserCount() });
    if (p === '/api/heartbeat') return handleHeartbeat(req);

    if (p.startsWith('/css/') || p.startsWith('/images/') || p === '/favicon.ico') {
      return handleStatic(p);
    }

    if (p === '/api/refresh' && req.method === 'POST') return handleRefresh();
    if (p === '/api/refresh' && req.method === 'GET') return handleRefresh(); // dev convenience

    if (p === '/admin') return handleAdmin(req);
    if (p === '/') return handleHome(req);

    if (p.startsWith('/date/')) return redirect('/');

    const baseTeamM = p.match(/^\/base-team\/(.+)$/);
    if (baseTeamM) return handleBaseTeam(req, decodeURIComponent(baseTeamM[1]));

    const teamM = p.match(/^\/team\/(.+)$/);
    if (teamM) return handleTeam(req, decodeURIComponent(teamM[1]));

    return new Response('Not Found', { status: 404 });
  },
  error(err) {
    console.error('Unhandled server error:', err);
    return new Response('Internal Server Error', { status: 500 });
  },
});

console.log(`Server running at http://localhost:${PORT} (startup: ${Date.now() - startTime}ms)`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    console.log(`${sig} received, shutting down gracefully...`);
    await server.stop(true);
    process.exit(0);
  });
}
