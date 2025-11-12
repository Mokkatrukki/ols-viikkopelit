import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

interface ExtractedData {
  documentDate: string;
  games: GameInfo[];
}

interface GroupedTeamEntry {
  year: string;
  teams: string[];
}

// Field map data for venue images
const fieldMapData: { [key: string]: { src: string; width: number; height: number; } } = {
  "KEMPELE AREENA KENTTÄ 1": { src: '/images/kempele.webp', width: 800, height: 600 },
  "KEMPELE AREENA KENTTÄ 2": { src: '/images/kempele.webp', width: 800, height: 600 },
  "KEMPELE AREENA KENTTÄ 3": { src: '/images/kempele.webp', width: 800, height: 600 },
  "KEMPELE AREENA KENTTÄ 4": { src: '/images/kempele.webp', width: 800, height: 600 },
  "KURIKKAHAANTIEN HALLI KENTTÄ 1": { src: '/images/kurikka.webp', width: 800, height: 600 },
  "KURIKKAHAANTIEN HALLI KENTTÄ 2": { src: '/images/kurikka.webp', width: 800, height: 600 },
};

// Helper function to extract base year from game year
function getBaseYear(gameYear: string): string {
  const match = gameYear.match(/^(\d{4})/);
  return match ? match[1] : "Muut";
}

// Helper function to get all unique teams grouped by year
function getGroupedTeams(allGamesData: GameInfo[]): GroupedTeamEntry[] {
  const teamsByBaseYear: Record<string, Set<string>> = {};

  allGamesData.forEach(game => {
    const baseYear = getBaseYear(game.year);
    if (!teamsByBaseYear[baseYear]) {
      teamsByBaseYear[baseYear] = new Set<string>();
    }
    if (game.team1 && game.team1.trim() !== "") {
      teamsByBaseYear[baseYear].add(game.team1);
    }
    if (game.team2 && game.team2.trim() !== "") {
      teamsByBaseYear[baseYear].add(game.team2);
    }
  });

  const result: GroupedTeamEntry[] = [];
  Object.keys(teamsByBaseYear).sort((a, b) => {
    if (a === "Muut") return 1;
    if (b === "Muut") return -1;
    return parseInt(a, 10) - parseInt(b, 10);
  }).forEach(baseYear => {
    result.push({
      year: baseYear,
      teams: Array.from(teamsByBaseYear[baseYear]).sort()
    });
  });

  return result;
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
const jsonDataPath = path.join(__dirname, '..', 'data', 'games.json');
let allGames: GameInfo[] = [];
let documentDate: string = '';
let cachedGroupedTeams: GroupedTeamEntry[] = [];
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
    documentDate = parsedData.documentDate || '';
    cachedGroupedTeams = getGroupedTeams(allGames);

    dataLoaded = true;
    console.log(`✅ Loaded ${allGames.length} games`);
    console.log(`⚡ Data load completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('❌ Error loading game data:', error);
    allGames = [];
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
app.set('views', path.join(__dirname, '..', 'views'));

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
app.use('/css', express.static(path.join(__dirname, '..', 'public', 'css'), {
  maxAge: '1y',
  immutable: true
}));
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images'), {
  maxAge: '1y',
  immutable: true
}));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '5m'
}));

// Home route
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
    res.render('index', {
      documentTitle: 'Talviliiga - Ladataan...',
      groupedTeams: [],
      selectedTeam: null,
      gamesForTeam: [],
      fieldMapData,
      loading: true
    });
    return;
  }

  res.render('index', {
    documentTitle: `Talviliiga${documentDate ? ' - ' + documentDate : ''}`,
    groupedTeams: cachedGroupedTeams,
    selectedTeam: null,
    gamesForTeam: [],
    fieldMapData,
    loading: false
  });
});

// Team route
app.get('/team/:teamName', async (req: Request, res: Response) => {
  const teamName = decodeURIComponent(req.params.teamName);

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

  if (!dataLoaded) {
    res.render('index', {
      documentTitle: 'Talviliiga - Ladataan...',
      groupedTeams: [],
      selectedTeam: teamName,
      gamesForTeam: [],
      fieldMapData,
      loading: true
    });
    return;
  }

  let gamesForTeam = allGames
    .filter(game => game.team1 === teamName || game.team2 === teamName)
    .map(game => {
      const opponent = game.team1 === teamName ? game.team2 : game.team1;
      return { ...game, opponent: opponent || 'Vastustaja puuttuu' };
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

  res.render('index', {
    documentTitle: `Talviliiga${documentDate ? ' - ' + documentDate : ''}`,
    groupedTeams: cachedGroupedTeams,
    selectedTeam: teamName,
    gamesForTeam,
    fieldMapData,
    loading: false
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🌐 Server running at http://localhost:${PORT}`);
  console.log(`🏁 Startup time: ${Date.now() - appStartTime}ms`);
});
