import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine project root (works in both dev and compiled modes)
// In dev: __dirname = /path/to/talviliiga/src
// In prod: __dirname = /path/to/talviliiga/dist/src
const projectRoot = __dirname.includes('/dist/')
  ? path.join(__dirname, '..', '..') // From dist/src to project root
  : path.join(__dirname, '..'); // From src to project root

// Interfaces
interface GameInfo {
  field: string;
  gameDuration: string;
  gameType: string;
  year: string;
  time: string;
  team1: string;
  team2: string;
  date?: string;
  location?: string;
}

interface DateGroup {
  date: string;
  fullDate: string;
  games: GameInfo[];
}

interface ExtractedData {
  documentDate: string;
  games: GameInfo[];
  gamesByDate: DateGroup[];
}

interface BaseTeam {
  name: string; // Base team name like "OLS Kreikka 17"
  subteams: string[]; // Full subteam names like "OLS Kreikka 17 Aek"
}

interface GroupedTeamEntry {
  year: string;
  teams: string[];
  baseTeams: BaseTeam[]; // Base teams for this year
  individualTeams: string[]; // Teams not part of any base team
}

// Field map data for venue images
const fieldMapData: { [key: string]: { src: string; width: number; height: number; } } = {
  "KEMPELE AREENA KENTTÄ 1": { src: '/images/kempele-kentta-1.webp', width: 1000, height: 707 },
  "KEMPELE AREENA KENTTÄ 2": { src: '/images/kempele-kentta-2.webp', width: 1000, height: 707 },
  "KEMPELE AREENA KENTTÄ 3": { src: '/images/kempele-kentta-3.webp', width: 1000, height: 707 },
  "KEMPELE AREENA KENTTÄ 4": { src: '/images/kempele-kentta-4.webp', width: 1000, height: 707 },
  "KURIKKAHAANTIEN HALLI KENTTÄ 1": { src: '/images/kurikka.webp', width: 800, height: 600 },
  "KURIKKAHAANTIEN HALLI KENTTÄ 2": { src: '/images/kurikka.webp', width: 800, height: 600 },
};

// Helper function to find longest common prefix between two strings
function longestCommonPrefix(str1: string, str2: string): string {
  let i = 0;
  while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
    i++;
  }
  // Trim to last space to avoid cutting words in half
  const prefix = str1.substring(0, i);
  const lastSpaceIndex = prefix.lastIndexOf(' ');
  return lastSpaceIndex > 0 ? prefix.substring(0, lastSpaceIndex).trim() : prefix.trim();
}

// Helper function to dynamically group teams by finding common prefixes
function findTeamGroups(teamNames: string[]): Map<string, string[]> {
  // First, find all possible groupings
  const allPossibleGroups: Array<{prefix: string, teams: string[]}> = [];

  for (let i = 0; i < teamNames.length; i++) {
    for (let j = i + 1; j < teamNames.length; j++) {
      const team1 = teamNames[i];
      const team2 = teamNames[j];
      const commonPrefix = longestCommonPrefix(team1, team2);

      // Only consider meaningful prefixes
      const prefixWords = commonPrefix.split(/\s+/).filter(w => w.length > 0);
      const isMeaningfulPrefix =
        (commonPrefix.length >= 10 && prefixWords.length >= 3) || // Long prefix with 3+ words
        (prefixWords.length >= 2 && prefixWords.every(word => word.length >= 2)) || // 2+ words, each 2+ chars
        (prefixWords.length === 1 && commonPrefix.length >= 3); // Single word, at least 3 chars

      if (isMeaningfulPrefix) {
        // Find all teams that match this prefix
        const matchingTeams = teamNames.filter(team =>
          team.startsWith(commonPrefix + ' ')
        );

        if (matchingTeams.length >= 2) {
          allPossibleGroups.push({
            prefix: commonPrefix,
            teams: matchingTeams.sort()
          });
        }
      }
    }
  }

  // Remove duplicate groups (same teams, different prefix length)
  const uniqueGroups: Array<{prefix: string, teams: string[]}> = [];

  for (const group of allPossibleGroups) {
    const teamSet = new Set(group.teams);
    const isDuplicate = uniqueGroups.some(existing => {
      const existingSet = new Set(existing.teams);
      return teamSet.size === existingSet.size &&
             [...teamSet].every(team => existingSet.has(team));
    });

    if (!isDuplicate) {
      uniqueGroups.push(group);
    } else {
      // If duplicate, keep the one with longer (more specific) prefix
      const existingIndex = uniqueGroups.findIndex(existing => {
        const existingSet = new Set(existing.teams);
        return teamSet.size === existingSet.size &&
               [...teamSet].every(team => existingSet.has(team));
      });

      if (existingIndex !== -1 && group.prefix.length > uniqueGroups[existingIndex].prefix.length) {
        uniqueGroups[existingIndex] = group;
      }
    }
  }

  // Sort by specificity (longer prefix first) and group size
  uniqueGroups.sort((a, b) => {
    if (a.prefix.length !== b.prefix.length) {
      return b.prefix.length - a.prefix.length; // Longer prefix first
    }
    return b.teams.length - a.teams.length; // More teams first
  });

  // Select non-overlapping groups greedily (most specific first)
  const finalGroups = new Map<string, string[]>();
  const usedTeams = new Set<string>();

  for (const group of uniqueGroups) {
    const hasOverlap = group.teams.some(team => usedTeams.has(team));

    if (!hasOverlap && group.teams.length > 1) {
      finalGroups.set(group.prefix, group.teams);
      group.teams.forEach(team => usedTeams.add(team));
    }
  }

  return finalGroups;
}

// Helper function to group teams by their base names using dynamic detection
function getBaseTeams(allGamesData: GameInfo[]): BaseTeam[] {
  // Collect all unique team names
  const allTeamNames: string[] = [];
  const teamNameSet = new Set<string>();

  allGamesData.forEach(game => {
    if (game.team1 && game.team1.trim() !== "") {
      if (!teamNameSet.has(game.team1)) {
        teamNameSet.add(game.team1);
        allTeamNames.push(game.team1);
      }
    }
    if (game.team2 && game.team2.trim() !== "") {
      if (!teamNameSet.has(game.team2)) {
        teamNameSet.add(game.team2);
        allTeamNames.push(game.team2);
      }
    }
  });

  // Use dynamic grouping to find teams with common prefixes
  const teamGroups = findTeamGroups(allTeamNames);

  // Convert to BaseTeam array
  const result: BaseTeam[] = [];
  teamGroups.forEach((subteams, baseName) => {
    result.push({
      name: baseName,
      subteams: subteams.sort() // Sort subteams alphabetically
    });
  });

  // Sort alphabetically by base team name
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

// Helper function to extract base year from game year
function getBaseYear(gameYear: string): string {
  const match = gameYear.match(/^(\d{4})/);
  return match ? match[1] : "Muut";
}

// Helper function to split team name into parent and subteam
function splitTeamName(teamName: string, baseTeams: BaseTeam[]): { parent: string | null, subteam: string | null, fullName: string } {
  // Check if this team is part of any base team
  for (const baseTeam of baseTeams) {
    if (baseTeam.subteams.includes(teamName)) {
      // This is a subteam - extract the subteam part
      const subteamPart = teamName.substring(baseTeam.name.length).trim();
      return {
        parent: baseTeam.name,
        subteam: subteamPart,
        fullName: teamName
      };
    }
  }

  // Not a subteam, return as-is
  return {
    parent: null,
    subteam: null,
    fullName: teamName
  };
}

// Helper function to get all unique teams (without year grouping)
function getGroupedTeams(allGamesData: GameInfo[]): GroupedTeamEntry[] {
  // Collect all unique teams
  const allTeamsSet = new Set<string>();

  allGamesData.forEach(game => {
    if (game.team1 && game.team1.trim() !== "") {
      allTeamsSet.add(game.team1);
    }
    if (game.team2 && game.team2.trim() !== "") {
      allTeamsSet.add(game.team2);
    }
  });

  const allTeamsArray = Array.from(allTeamsSet);

  // Find team groups (base teams with subteams)
  const teamGroups = findTeamGroups(allTeamsArray);
  const baseTeams: BaseTeam[] = [];
  const allSubteams = new Set<string>();

  teamGroups.forEach((subteams, baseName) => {
    baseTeams.push({
      name: baseName,
      subteams: subteams.sort()
    });
    subteams.forEach(team => allSubteams.add(team));
  });

  // Find individual teams (not part of any base team)
  const individualTeams = allTeamsArray.filter(team => !allSubteams.has(team)).sort();


  // Return as a single entry (no year-based grouping)
  return [{
    year: "",
    teams: allTeamsArray.sort(),
    baseTeams: baseTeams.sort((a, b) => a.name.localeCompare(b.name)),
    individualTeams
  }];
}

// Helper function to get teams for a specific date (without year grouping)
// Uses GLOBAL base team structure to avoid duplicates
function getGroupedTeamsForDate(date: string): GroupedTeamEntry[] {
  const dateGroup = gamesByDate.find(dg => dg.date === date);
  if (!dateGroup) return [];

  // Collect all unique teams for this date
  const teamsForDate = new Set<string>();
  dateGroup.games.forEach(game => {
    if (game.team1 && game.team1.trim() !== "") {
      teamsForDate.add(game.team1);
    }
    if (game.team2 && game.team2.trim() !== "") {
      teamsForDate.add(game.team2);
    }
  });

  const teamsArray = Array.from(teamsForDate);

  // Use GLOBAL base teams (cachedBaseTeams) to filter out subteams
  // This prevents subteams from appearing as individual teams even if
  // only one subteam plays on this specific date
  const baseTeamsForDate: BaseTeam[] = [];
  const allGlobalSubteams = new Set<string>();

  // First, collect all subteams from global cache
  cachedBaseTeams.forEach(globalBaseTeam => {
    globalBaseTeam.subteams.forEach(subteam => {
      allGlobalSubteams.add(subteam);
    });
  });

  // Only include base teams that have at least one subteam playing on this date
  cachedBaseTeams.forEach(globalBaseTeam => {
    const subteamsOnThisDate = globalBaseTeam.subteams.filter(subteam =>
      teamsForDate.has(subteam)
    );

    if (subteamsOnThisDate.length > 0) {
      baseTeamsForDate.push({
        name: globalBaseTeam.name,
        subteams: subteamsOnThisDate.sort()
      });
    }
  });

  // Find individual teams (not part of any base team globally)
  const individualTeams = teamsArray.filter(team => !allGlobalSubteams.has(team)).sort();


  // Return as a single entry (no year-based grouping)
  return [{
    year: "",
    teams: teamsArray.sort(),
    baseTeams: baseTeamsForDate.sort((a, b) => a.name.localeCompare(b.name)),
    individualTeams
  }];
}

// Helper function to parse date string (dd.mm.yyyy) to Date object
function parseFullDate(dateStr: string): Date | null {
  const parts = dateStr.split('.');
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Months are 0-indexed
  const year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, day);
}

// Helper function to find the default date (today or next future date)
function findDefaultDate(): string | null {
  if (gamesByDate.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find today or the next future date
  for (const dateGroup of gamesByDate) {
    const gameDate = parseFullDate(dateGroup.fullDate);
    if (gameDate && gameDate >= today) {
      return dateGroup.date;
    }
  }

  // If no future dates, return the last date
  return gamesByDate[gamesByDate.length - 1].date;
}

// Helper function to parse time to minutes
function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return NaN;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return NaN;
  return hours * 60 + minutes;
}

// Express app setup
const app = express();
const PORT = process.env.PORT || 3003;

console.log('🚀 Starting Talviliiga Tournament Viewer...');
const appStartTime = Date.now();

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Data storage
const jsonDataPath = path.join(projectRoot, 'data', 'games.json');
let allGames: GameInfo[] = [];
let gamesByDate: DateGroup[] = [];
let documentDate: string = '';
let cachedGroupedTeams: GroupedTeamEntry[] = [];
let cachedBaseTeams: BaseTeam[] = [];
let dataLoaded = false;

// Function to load game data
async function loadGameData() {
  const startTime = Date.now();
  console.log('📊 Loading game data...');

  try {
    if (!fs.existsSync(jsonDataPath)) {
      console.warn(`Data file not found at ${jsonDataPath}. Run 'npm run parse' to generate it.`);
      allGames = [];
      documentDate = '';
      cachedGroupedTeams = [];
      dataLoaded = true;
      console.log(`⚡ Data load completed in ${Date.now() - startTime}ms (no data file)`);
      return;
    }

    const fileContent = await fs.promises.readFile(jsonDataPath, 'utf-8');
    const parsedData: ExtractedData = JSON.parse(fileContent);

    allGames = parsedData.games || [];
    gamesByDate = parsedData.gamesByDate || [];
    documentDate = parsedData.documentDate || '';
    cachedGroupedTeams = getGroupedTeams(allGames);
    cachedBaseTeams = getBaseTeams(allGames);

    dataLoaded = true;
    console.log(`✅ Loaded ${allGames.length} games across ${gamesByDate.length} dates`);
    console.log(`✅ Found ${cachedBaseTeams.length} base teams`);
    console.log(`⚡ Data load completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('❌ Error loading game data:', error);
    allGames = [];
    gamesByDate = [];
    documentDate = '';
    cachedGroupedTeams = [];
    dataLoaded = true;
  }
}

// Start async data load (don't wait for it - for fast startup!)
loadGameData().catch(error => {
  console.error('Failed to load data:', error);
});

// Setup view engine
app.set('view engine', 'ejs');
app.set('views', path.join(projectRoot, 'views'));

// Request logging middleware for tracking usage
app.use((req: Request, res: Response, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  const userAgent = req.get('user-agent') || 'unknown';
  const ip = req.get('x-forwarded-for') || req.ip || 'unknown';

  // Log page views (skip static assets, health checks, and favicon)
  if (!url.startsWith('/css') &&
      !url.startsWith('/images') &&
      !url.startsWith('/favicon') &&
      url !== '/health') {
    console.log(`📊 [${timestamp}] ${method} ${url} - IP: ${ip.split(',')[0]} - UA: ${userAgent.substring(0, 50)}`);
  }

  next();
});

// Security headers
app.use((req: Request, res: Response, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self';"
  );
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Serve static files with caching
app.use('/css', express.static(path.join(projectRoot, 'public', 'css'), {
  maxAge: '1y',
  immutable: true
}));
app.use('/images', express.static(path.join(projectRoot, 'public', 'images'), {
  maxAge: '1y',
  immutable: true
}));
app.use(express.static(path.join(projectRoot, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '5m'
}));

// Helper function to get base URL from request
function getBaseUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'talviliiga.fly.dev';
  return `${protocol}://${host}`;
}

// Home route - redirect to default date
app.get('/', async (req: Request, res: Response) => {
  if (!dataLoaded) {
    try {
      await Promise.race([
        loadGameData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
    } catch (error) {
      console.log('⚡ Quick load timeout, showing loading state');
    }
  }

  if (!dataLoaded) {
    const baseUrl = getBaseUrl(req);
    res.render('index', {
      documentTitle: 'Talviliiga - Ladataan...',
      metaTitle: 'Talviliiga',
      metaDescription: 'Talviliiga tournament schedule viewer - see all tournament games',
      metaUrl: baseUrl,
      groupedTeams: [],
      selectedTeam: null,
      teamNameSplit: null,
      selectedDate: null,
      gamesForTeam: [],
      fieldMapData,
      loading: true,
      gamesByDate: [],
      currentDateIndex: 0
    });
    return;
  }

  // Find default date and redirect
  const defaultDate = findDefaultDate();
  if (defaultDate) {
    res.redirect(`/date/${encodeURIComponent(defaultDate)}`);
  } else {
    const baseUrl = getBaseUrl(req);
    res.render('index', {
      documentTitle: `Talviliiga${documentDate ? ' - ' + documentDate : ''}`,
      metaTitle: 'Talviliiga',
      metaDescription: 'Talviliiga tournament schedule viewer - see all tournament games',
      metaUrl: baseUrl,
      groupedTeams: [],
      selectedTeam: null,
      teamNameSplit: null,
      selectedDate: null,
      gamesForTeam: [],
      fieldMapData,
      loading: false,
      gamesByDate: [],
      currentDateIndex: 0
    });
  }
});

// Date route - show games for a specific date
app.get('/date/:date', async (req: Request, res: Response) => {
  const selectedDate = decodeURIComponent(req.params.date);

  if (!dataLoaded) {
    try {
      await Promise.race([
        loadGameData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
    } catch (error) {
      console.log('⚡ Quick load timeout for date route');
    }
  }

  const baseUrl = getBaseUrl(req);
  const currentUrl = `${baseUrl}/date/${encodeURIComponent(selectedDate)}`;

  if (!dataLoaded) {
    res.render('index', {
      documentTitle: 'Talviliiga - Ladataan...',
      metaTitle: `Talviliiga - ${selectedDate}`,
      metaDescription: `Talviliiga tournament games on ${selectedDate}`,
      metaUrl: currentUrl,
      groupedTeams: [],
      selectedTeam: null,
      teamNameSplit: null,
      selectedDate,
      gamesForTeam: [],
      fieldMapData,
      loading: true,
      gamesByDate: [],
      currentDateIndex: 0
    });
    return;
  }

  const currentDateIndex = gamesByDate.findIndex(dg => dg.date === selectedDate);
  const dateGroup = gamesByDate[currentDateIndex];

  if (!dateGroup) {
    res.redirect('/');
    return;
  }

  res.render('index', {
    documentTitle: `Talviliiga - ${dateGroup.fullDate}`,
    metaTitle: `Talviliiga - ${dateGroup.fullDate}`,
    metaDescription: `Talviliiga tournament games on ${dateGroup.fullDate}`,
    metaUrl: currentUrl,
    groupedTeams: getGroupedTeamsForDate(selectedDate),
    selectedTeam: null,
    teamNameSplit: null,
    selectedDate,
    gamesForTeam: [],
    fieldMapData,
    loading: false,
    gamesByDate,
    currentDateIndex
  });
});

// Base team portal route - shows all subteams for a base team
app.get('/base-team/:baseTeamName', async (req: Request, res: Response) => {
  const baseTeamName = decodeURIComponent(req.params.baseTeamName);

  if (!dataLoaded) {
    try {
      await Promise.race([
        loadGameData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
    } catch (error) {
      console.log('⚡ Quick load timeout for base team route');
    }
  }

  if (!dataLoaded) {
    res.render('base_team_portal', {
      documentTitle: `${baseTeamName} - Joukkueportaali`,
      baseTeamName: baseTeamName,
      subteams: [],
      loading: true,
      fieldMapData
    });
    return;
  }

  // Find the base team
  const baseTeam = cachedBaseTeams.find(bt => bt.name === baseTeamName);
  if (!baseTeam) {
    res.status(404).send('Base team not found');
    return;
  }

  // Get next game for each subteam
  const subteamsWithNextGame = baseTeam.subteams.map(subteamName => {
    const gamesForSubteam = allGames
      .filter(game => game.team1 === subteamName || game.team2 === subteamName)
      .map(game => {
        const opponent = game.team1 === subteamName ? game.team2 : game.team1;
        // Find the full date for this game
        let fullDate = game.date;
        const dateGroup = gamesByDate.find(dg => dg.date === game.date);
        if (dateGroup) {
          fullDate = dateGroup.fullDate;
        }
        return { ...game, opponent: opponent || 'Vastustaja puuttuu', fullDate };
      })
      .sort((a, b) => {
        // Sort by date first
        if (a.date && b.date && a.date !== b.date) {
          return a.date.localeCompare(b.date);
        }
        // Then by time
        const timeA = parseTimeToMinutes(a.time);
        const timeB = parseTimeToMinutes(b.time);
        if (isNaN(timeA) || isNaN(timeB)) return 0;
        return timeA - timeB;
      });

    const nextGame = gamesForSubteam[0] || null; // First game is the next game

    return {
      name: subteamName,
      nextGame: nextGame
    };
  });

  // Sort alphabetically by subteam name
  subteamsWithNextGame.sort((a, b) => a.name.localeCompare(b.name));

  res.render('base_team_portal', {
    documentTitle: `${baseTeamName} - Joukkueportaali`,
    baseTeamName: baseTeamName,
    subteams: subteamsWithNextGame,
    loading: false,
    fieldMapData
  });
});

// Team route with optional date
app.get('/team/:teamName', async (req: Request, res: Response) => {
  const teamName = decodeURIComponent(req.params.teamName);
  const selectedDate = req.query.date ? String(req.query.date) : null;

  if (!dataLoaded) {
    try {
      await Promise.race([
        loadGameData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
    } catch (error) {
      console.log('⚡ Quick load timeout for team route');
    }
  }

  const baseUrl = getBaseUrl(req);
  const currentUrl = selectedDate
    ? `${baseUrl}/team/${encodeURIComponent(teamName)}?date=${encodeURIComponent(selectedDate)}`
    : `${baseUrl}/team/${encodeURIComponent(teamName)}`;

  if (!dataLoaded) {
    res.render('index', {
      documentTitle: 'Talviliiga - Ladataan...',
      metaTitle: `${teamName} - Talviliiga`,
      metaDescription: `View ${teamName}'s tournament schedule${selectedDate ? ' on ' + selectedDate : ''}`,
      metaUrl: currentUrl,
      groupedTeams: [],
      selectedTeam: teamName,
      teamNameSplit: null,
      selectedDate,
      gamesForTeam: [],
      fieldMapData,
      loading: true,
      gamesByDate: [],
      currentDateIndex: 0
    });
    return;
  }

  // If no date is specified, redirect to the default date
  if (!selectedDate) {
    const defaultDate = findDefaultDate();
    if (defaultDate) {
      res.redirect(`/team/${encodeURIComponent(teamName)}?date=${encodeURIComponent(defaultDate)}`);
      return;
    }
  }

  // Filter games by date if specified
  let gamesToFilter = allGames;
  let dateGroupForMeta = null;
  if (selectedDate) {
    const dateGroup = gamesByDate.find(dg => dg.date === selectedDate);
    if (dateGroup) {
      gamesToFilter = dateGroup.games;
      dateGroupForMeta = dateGroup;
    }
  }

  let gamesForTeam = gamesToFilter
    .filter(game => game.team1 === teamName || game.team2 === teamName)
    .map(game => {
      const opponent = game.team1 === teamName ? game.team2 : game.team1;
      // Find the full date for this game
      let fullDate = game.date;
      const dateGroup = gamesByDate.find(dg => dg.date === game.date);
      if (dateGroup) {
        fullDate = dateGroup.fullDate;
      }
      return { ...game, opponent: opponent || 'Vastustaja puuttuu', fullDate };
    });

  // Sort games by date and time
  gamesForTeam.sort((a, b) => {
    // First sort by date
    if (a.date && b.date && a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    // Then sort by time
    const timeA = parseTimeToMinutes(a.time);
    const timeB = parseTimeToMinutes(b.time);
    if (isNaN(timeA) || isNaN(timeB)) return 0;
    return timeA - timeB;
  });

  // Calculate break time between games
  for (let i = 1; i < gamesForTeam.length; i++) {
    const currentGame = gamesForTeam[i] as any; // Use any to add new property
    const previousGame = gamesForTeam[i - 1];

    // Only calculate break if games are on the same date
    if (currentGame.date === previousGame.date) {
      const previousGameStartMinutes = parseTimeToMinutes(previousGame.time);
      const currentGameStartMinutes = parseTimeToMinutes(currentGame.time);

      // Extract game duration (e.g., "25MIN" -> 25)
      const durationMatch = previousGame.gameDuration.match(/(\d+)/);
      const previousGameDuration = durationMatch ? parseInt(durationMatch[1], 10) : 0;

      if (!isNaN(previousGameStartMinutes) && !isNaN(currentGameStartMinutes) && previousGameDuration > 0) {
        const previousGameEndMinutes = previousGameStartMinutes + previousGameDuration;
        const breakDuration = currentGameStartMinutes - previousGameEndMinutes;

        if (breakDuration > 0) {
          currentGame.breakDurationMinutes = breakDuration;
        }
      }
    }
  }

  const currentDateIndex = selectedDate ? gamesByDate.findIndex(dg => dg.date === selectedDate) : -1;
  const groupedTeams = selectedDate ? getGroupedTeamsForDate(selectedDate) : cachedGroupedTeams;

  // Split team name for better display
  const teamNameSplit = splitTeamName(teamName, cachedBaseTeams);

  // Create metadata description with first game info if available
  let metaDescription = `View ${teamName}'s tournament schedule`;
  if (dateGroupForMeta) {
    metaDescription += ` on ${dateGroupForMeta.fullDate}`;
  }
  if (gamesForTeam.length > 0) {
    const firstGame = gamesForTeam[0];
    // Include date if not already in the description
    if (!dateGroupForMeta && firstGame.date) {
      metaDescription += `. First game: ${firstGame.date} at ${firstGame.time} vs ${firstGame.opponent}`;
    } else {
      metaDescription += `. First game: ${firstGame.time} vs ${firstGame.opponent}`;
    }
  }

  // Create title with parent team and subteam if available
  let metaTitle = teamName;
  if (teamNameSplit.parent && teamNameSplit.subteam) {
    metaTitle = `${teamNameSplit.parent} ${teamNameSplit.subteam}`;
  }
  if (dateGroupForMeta) {
    metaTitle += ` - ${dateGroupForMeta.fullDate}`;
  }
  metaTitle += ' - Talviliiga';

  res.render('index', {
    documentTitle: `Talviliiga${documentDate ? ' - ' + documentDate : ''}`,
    metaTitle,
    metaDescription,
    metaUrl: currentUrl,
    groupedTeams,
    selectedTeam: teamName,
    teamNameSplit, // { parent, subteam, fullName }
    selectedDate,
    gamesForTeam,
    fieldMapData,
    loading: false,
    gamesByDate,
    currentDateIndex: currentDateIndex >= 0 ? currentDateIndex : 0
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Server running at http://localhost:${PORT}`);
  console.log(`🏁 Startup time: ${Date.now() - appStartTime}ms`);
});
