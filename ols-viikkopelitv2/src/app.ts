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

function buildGroupedTeamsForDate(date: string, allGames: Game[], cachedBase: BaseTeam[]): GroupedTeamEntry[] {
  const gamesOnDate = allGames.filter(g => g.date === date);
  const onDate = new Set([...gamesOnDate.map(g => g.team1), ...gamesOnDate.map(g => g.team2)].filter(Boolean));
  const allGlobalSubs = new Set(cachedBase.flatMap(b => b.subteams));

  const baseTeams: BaseTeam[] = cachedBase
    .map(b => ({ name: b.name, subteams: b.subteams.filter(s => onDate.has(s)) }))
    .filter(b => b.subteams.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const individualTeams = [...onDate].filter(n => !allGlobalSubs.has(n)).sort();

  return [{ year: '', teams: [...onDate].sort(), baseTeams, individualTeams }];
}

function splitTeamName(name: string, baseTeams: BaseTeam[]): { parent: string | null; subteam: string | null; fullName: string } {
  for (const bt of baseTeams) {
    if (bt.subteams.includes(name)) {
      return { parent: bt.name, subteam: name.substring(bt.name.length).trim(), fullName: name };
    }
  }
  return { parent: null, subteam: null, fullName: name };
}

function parseFullDate(s: string): Date | null {
  const p = s.split('.');
  if (p.length !== 3) return null;
  const d = parseInt(p[0]), m = parseInt(p[1]) - 1, y = parseInt(p[2]);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  return new Date(y, m, d);
}

function findDefaultDate(gamesByDate: DateGroup[]): string | null {
  if (!gamesByDate.length) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const dg of gamesByDate) {
    const gd = parseFullDate(dg.fullDate);
    if (gd && gd >= today) return dg.date;
  }
  return gamesByDate[gamesByDate.length - 1].date;
}

function parseTimeToMinutes(s: string): number {
  const p = s.split(':');
  if (p.length !== 2) return NaN;
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

// ─── Data store ───────────────────────────────────────────────────────────────

let gamesData: GamesData | null = null;
let cachedGroupedTeams: GroupedTeamEntry[] = [];
let cachedBaseTeams: BaseTeam[] = [];

async function loadData(): Promise<void> {
  try {
    if (!fs.existsSync(DATA_PATH)) return;
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    gamesData = JSON.parse(raw) as GamesData;
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

    // Skip re-parsing if this is the same PDF we already have
    if (gamesData?.pdfUrl === pdf.url && gamesData.games.length > 0) {
      return { ok: true, message: `Already up to date (${pdf.url})` };
    }

    const data = await parsePdf(pdf.localPath, pdf.url);
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

async function render(template: string, data: Record<string, unknown>): Promise<Response> {
  const html = await ejs.renderFile(path.join(ROOT, 'views', template), data);
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

async function handleHome(req: Request): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  const gamesByDate = gamesData?.gamesByDate ?? [];
  const defaultDate = findDefaultDate(gamesByDate);

  if (defaultDate) return redirect(`/date/${encodeURIComponent(defaultDate)}`);

  return render('index.ejs', {
    documentTitle: 'OLS Viikkopelit',
    metaTitle: 'OLS Viikkopelit',
    metaDescription: 'OLS:n viikkopelien otteluohjelma',
    metaUrl: baseUrl,
    groupedTeams: [],
    selectedTeam: null,
    teamNameSplit: null,
    selectedDate: null,
    gamesForTeam: [],
    fieldMapData: {},
    gamesByDate: [],
    currentDateIndex: 0,
    lastUpdated: gamesData?.lastUpdated ?? null,
    pdfUrl: gamesData?.pdfUrl ?? null,
  });
}

async function handleDate(req: Request, selectedDate: string): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  const games = gamesData?.games ?? [];
  const gamesByDate = gamesData?.gamesByDate ?? [];
  const currentDateIndex = gamesByDate.findIndex(dg => dg.date === selectedDate);
  const dateGroup = gamesByDate[currentDateIndex];

  if (!dateGroup) return redirect('/');

  return render('index.ejs', {
    documentTitle: `OLS Viikkopelit - ${dateGroup.fullDate}`,
    metaTitle: `OLS Viikkopelit - ${dateGroup.fullDate}`,
    metaDescription: `Viikkopelit ${dateGroup.fullDate}`,
    metaUrl: `${baseUrl}/date/${encodeURIComponent(selectedDate)}`,
    groupedTeams: buildGroupedTeamsForDate(selectedDate, games, cachedBaseTeams),
    selectedTeam: null,
    teamNameSplit: null,
    selectedDate,
    gamesForTeam: [],
    fieldMapData: {},
    gamesByDate,
    currentDateIndex,
    lastUpdated: gamesData?.lastUpdated ?? null,
    pdfUrl: gamesData?.pdfUrl ?? null,
  });
}

async function handleTeam(req: Request, teamName: string, url: URL): Promise<Response> {
  const baseUrl = getBaseUrl(req);
  const selectedDate = url.searchParams.get('date');
  const games = gamesData?.games ?? [];
  const gamesByDate = gamesData?.gamesByDate ?? [];

  if (!selectedDate) {
    const defaultDate = findDefaultDate(gamesByDate);
    if (defaultDate) return redirect(`/team/${encodeURIComponent(teamName)}?date=${encodeURIComponent(defaultDate)}`);
  }

  const dateGames = selectedDate ? (gamesByDate.find(dg => dg.date === selectedDate)?.games ?? games) : games;
  const gamesForTeam = dateGames
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

  // Add break durations
  for (let i = 1; i < gamesForTeam.length; i++) {
    const cur = gamesForTeam[i] as any;
    const prev = gamesForTeam[i - 1];
    if (cur.date !== prev.date) continue;
    const durationMin = parseInt(prev.gameDuration) || 0;
    if (!durationMin) continue;
    const breakMin = parseTimeToMinutes(cur.time) - parseTimeToMinutes(prev.time) - durationMin;
    if (breakMin > 0) cur.breakDurationMinutes = breakMin;
  }

  const currentDateIndex = selectedDate ? gamesByDate.findIndex(dg => dg.date === selectedDate) : -1;
  const groupedTeams = selectedDate ? buildGroupedTeamsForDate(selectedDate, games, cachedBaseTeams) : cachedGroupedTeams;
  const teamNameSplit = splitTeamName(teamName, cachedBaseTeams);

  const dateGroupForMeta = selectedDate ? gamesByDate.find(dg => dg.date === selectedDate) : null;
  const firstGame = gamesForTeam[0];
  const metaDescription = firstGame
    ? `Eka peli: ${firstGame.time}${firstGame.location ? ', ' + firstGame.location : ''}`
    : `${teamName} otteluohjelma`;

  let metaTitle = teamNameSplit.parent && teamNameSplit.subteam
    ? `${teamNameSplit.parent} ${teamNameSplit.subteam}`
    : teamName;
  if (dateGroupForMeta) metaTitle += ` - ${dateGroupForMeta.fullDate}`;
  metaTitle += ' - OLS Viikkopelit';

  return render('index.ejs', {
    documentTitle: `OLS Viikkopelit`,
    metaTitle,
    metaDescription,
    metaUrl: selectedDate
      ? `${baseUrl}/team/${encodeURIComponent(teamName)}?date=${encodeURIComponent(selectedDate)}`
      : `${baseUrl}/team/${encodeURIComponent(teamName)}`,
    groupedTeams,
    selectedTeam: teamName,
    teamNameSplit,
    selectedDate: selectedDate ?? null,
    gamesForTeam,
    fieldMapData: {},
    gamesByDate,
    currentDateIndex: currentDateIndex >= 0 ? currentDateIndex : 0,
    lastUpdated: gamesData?.lastUpdated ?? null,
    pdfUrl: gamesData?.pdfUrl ?? null,
  });
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
    return { name, nextGame: subGames[0] ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const nextDate = subteamsWithNextGame.find(s => s.nextGame)?.nextGame?.date ?? '';
  const metaTitle = nextDate
    ? `${baseTeamName} - ${nextDate} - OLS Viikkopelit`
    : `${baseTeamName} - OLS Viikkopelit`;
  const metaDescription = subteamsWithNextGame
    .map(s => {
      const short = s.name.split(' ').pop();
      return s.nextGame ? `${short} - ${s.nextGame.time}` : `${short} - Ei pelejä`;
    })
    .join(', ');

  return render('base_team_portal.ejs', {
    documentTitle: `${baseTeamName} - Joukkueportaali`,
    metaTitle,
    metaDescription,
    metaUrl: `${baseUrl}/base-team/${encodeURIComponent(baseTeamName)}`,
    baseTeamName,
    subteams: subteamsWithNextGame,
    fieldMapData: {},
    lastUpdated: gamesData?.lastUpdated ?? null,
  });
}

async function handleAdmin(req: Request): Promise<Response> {
  return render('admin.ejs', {
    documentTitle: 'Admin - OLS Viikkopelit',
    lastUpdated: gamesData?.lastUpdated ?? null,
    pdfUrl: gamesData?.pdfUrl ?? null,
    gamesCount: gamesData?.games.length ?? 0,
    datesCount: gamesData?.gamesByDate.length ?? 0,
  });
}

async function handleRefresh(): Promise<Response> {
  const result = await refreshData();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

async function handleStatic(pathname: string): Promise<Response> {
  const file = Bun.file(path.join(ROOT, 'public', pathname));
  if (await file.exists()) {
    return new Response(file, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  }
  return new Response('Not Found', { status: 404 });
}

// ─── Server ───────────────────────────────────────────────────────────────────

const startTime = Date.now();
console.log('Starting OLS Viikkopelit v2...');
await loadData();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    // Log requests (skip static)
    if (!p.startsWith('/css') && !p.startsWith('/images') && p !== '/health' && p !== '/favicon.ico') {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
      console.log(`${req.method} ${p} - ${ip}`);
    }

    if (p === '/health') return Response.json({ status: 'UP', games: gamesData?.games.length ?? 0 });

    if (p.startsWith('/css/') || p.startsWith('/images/') || p === '/favicon.ico') {
      return handleStatic(p);
    }

    if (p === '/api/refresh' && req.method === 'POST') return handleRefresh();
    if (p === '/api/refresh' && req.method === 'GET') return handleRefresh(); // dev convenience

    if (p === '/admin') return handleAdmin(req);
    if (p === '/') return handleHome(req);

    const dateM = p.match(/^\/date\/(.+)$/);
    if (dateM) return handleDate(req, decodeURIComponent(dateM[1]));

    const baseTeamM = p.match(/^\/base-team\/(.+)$/);
    if (baseTeamM) return handleBaseTeam(req, decodeURIComponent(baseTeamM[1]));

    const teamM = p.match(/^\/team\/(.+)$/);
    if (teamM) return handleTeam(req, decodeURIComponent(teamM[1]), url);

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running at http://localhost:${PORT} (startup: ${Date.now() - startTime}ms)`);
