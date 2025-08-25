import 'dotenv/config'; // Load .env file variables

process.on('uncaughtException', (err, origin) => {
  console.error('------------------------------------');
  console.error('UNCAUGHT EXCEPTION!');
  console.error('Error object inspect:');
  try {
    // Attempt to serialize or inspect more deeply
    console.dir(err, { depth: null, colors: true });
  } catch (inspectError) {
    console.error('Failed to inspect error object:', inspectError);
    console.error('Error basic toString:', String(err)); // Fallback
  }
  console.error('Origin:', origin);
  if (err && typeof err === 'object' && (err as any).stack) {
    console.error('Stack:', (err as any).stack);
  } else {
    console.error('Stack trace not available or error is not a standard Error object.');
  }
  console.error('------------------------------------');
  process.exit(1); // Important: exit on uncaught exceptions
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('------------------------------------');
  console.error('UNHANDLED REJECTION!');
  console.error('Reason object inspect:');
   try {
    // Attempt to serialize or inspect more deeply
    console.dir(reason, { depth: null, colors: true });
  } catch (inspectError) {
    console.error('Failed to inspect reason object:', inspectError);
    console.error('Reason basic toString:', String(reason)); // Fallback
  }
  console.error('At Promise:', promise);
  if (reason && typeof reason === 'object' && (reason as any).stack) {
    console.error('Stack:', (reason as any).stack);
  } else if (reason instanceof Error) {
    console.error('Stack (from Error instance):', reason.stack);
  } else {
    console.error('Stack trace not available or reason is not a standard Error object.');
  }
  console.error('------------------------------------');
  // Optionally, you might want to exit here too, or ensure all promises are handled.
  // process.exit(1);
});

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { getDatabase, Game, GameData } from './database.js'; // Import database functionality

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the GameInfo interface (can be moved to a shared types file later)
interface GameInfo {
  field: string;
  gameDuration: string;
  gameType: string;
  year: string; // This is the game's league/season year, e.g., "2017 EP"
  time: string;
  team1: string;
  team2: string;
}

// Helper function to extract the base year (e.g., "2017" from "2017 EP")
function getBaseYear(gameYear: string): string {
    const match = gameYear.match(/^(\d{4})/); // Extracts the first 4 digits
    return match ? match[1] : "Muut"; // Default to "Muut" if no 4-digit year found
}

interface GroupedTeamEntry {
  year: string; // This will be the base year like "2017"
  teams: string[];
}

// Helper function to parse HH.MM time to minutes since midnight
function parseTimeToMinutes(timeHM: string): number {
    const parts = timeHM.split('.');
    if (parts.length !== 2) return NaN; // Invalid format
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) return NaN;
    return hours * 60 + minutes;
}

// Helper function to get the start time of a game in minutes
function getGameStartTimeInMinutes(game: GameInfo): number {
    const timeParts = game.time.split(' - ');
    if (timeParts.length > 0) {
        return parseTimeToMinutes(timeParts[0]);
    }
    return NaN; // Should not happen with valid data
}

// Define fieldMapData with image dimensions for responsive design
const fieldMapData: { [key: string]: { src: string; width: number; height: number; } } = {
    "HEINÄPÄÄN TEKONURMI A": { src: '/images/tekonurmi_map_kentta_a.png', width: 672, height: 1010 },
    "HEINÄPÄÄN TEKONURMI B": { src: '/images/tekonurmi_map_kentta_b.png', width: 672, height: 1010 },
    "HEINÄPÄÄN TEKONURMI C": { src: '/images/tekonurmi_map_kentta_c.png', width: 672, height: 1010 },
    "HEINÄPÄÄN TEKONURMI D": { src: '/images/tekonurmi_map_kentta_d.png', width: 672, height: 1010 },

    "GARAM MASALA 1A": { src: '/images/garam_masala_map_kentta_1a.png', width: 672, height: 1010 },
    "GARAM MASALA 1B": { src: '/images/garam_masala_map_kentta_1b.png', width: 672, height: 1010 },
    "GARAM MASALA 1C": { src: '/images/garam_masala_map_kentta_1c.png', width: 672, height: 1010 },
    "GARAM MASALA 1D": { src: '/images/garam_masala_map_kentta_1d.png', width: 672, height: 1010 },
    "GARAM MASALA 2A": { src: '/images/garam_masala_map_kentta_2a.png', width: 672, height: 1010 },
    "GARAM MASALA 2B": { src: '/images/garam_masala_map_kentta_2b.png', width: 672, height: 1010 },
    "GARAM MASALA 2C": { src: '/images/garam_masala_map_kentta_2c.png', width: 672, height: 1010 },
    "GARAM MASALA 2D": { src: '/images/garam_masala_map_kentta_2d.png', width: 672, height: 1010 },

    "GARAM 2A": { src: '/images/garam_masala_map_kentta_2a.png', width: 672, height: 1010 },
    "GARAM 2B": { src: '/images/garam_masala_map_kentta_2b.png', width: 672, height: 1010 },

    // Add mappings for NURMI fields
    "NURMI 4A": { src: '/images/nurmi_map_kentta_4a.png', width: 672, height: 1010 },
    "NURMI 4B": { src: '/images/nurmi_map_kentta_4b.png', width: 672, height: 1010 },
    "NURMI 4C": { src: '/images/nurmi_map_kentta_4c.png', width: 672, height: 1010 },
    "NURMI 4D": { src: '/images/nurmi_map_kentta_4d.png', width: 672, height: 1010 },

    "HEPA - HALLI A": { src: '/images/heinapaan_halli_map_kentta_a.png', width: 672, height: 444 },
    "HEPA - HALLI B": { src: '/images/heinapaan_halli_map_kentta_b.png', width: 672, height: 444 },
    "HEPA - HALLI C": { src: '/images/heinapaan_halli_map_kentta_c.png', width: 672, height: 444 },
    "HEPA - HALLI D": { src: '/images/heinapaan_halli_map_kentta_d.png', width: 672, height: 444 }
};

// Helper function to get all unique teams and group them by extracted year
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
        // Sort "Muut" last, otherwise numerically by year
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

// Initialize Express app and database
const app = express();
let database: any = null; // Database instance

// Note: All data now fetched directly from database on each request

console.log('🚀 Starting OLS Viikkopelit application...');
const appStartTime = Date.now();

// Set view engine to EJS
console.log('🎨 Setting up view engine and middleware...');
const middlewareStart = Date.now();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views')); // Assuming views are in project_root/views

// Security headers middleware
app.use((req: Request, res: Response, next) => {
    // Content Security Policy
    res.setHeader('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data:; " +
        "connect-src 'self';"
    );
    
    // HTTP Strict Transport Security
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    
    // Cross-Origin-Opener-Policy
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    
    // X-Frame-Options (prevent clickjacking)
    res.setHeader('X-Frame-Options', 'DENY');
    
    // X-Content-Type-Options
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    next();
});

// Serve static files with caching headers
app.use('/css', express.static(path.join(__dirname, '..', 'public', 'css'), {
    maxAge: '1y', // Cache CSS for 1 year
    immutable: true
}));
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images'), {
    maxAge: '1y', // Cache images for 1 year
    immutable: true
}));
// General static files with shorter cache
app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '5m' // 1 day in prod, 5 min in dev
}));

// Middleware to parse URL-encoded bodies (for form submissions)
app.use(express.urlencoded({ extended: true }));
console.log(`🎨 Middleware setup completed in ${Date.now() - middlewareStart}ms`);

app.get('/', async (req: Request, res: Response) => {
    try {
        // Initialize database if not already done
        if (!database) {
            database = await getDatabase();
        }
        
        // Get fresh data from database
        const gameData = await database.getCurrentGameData();
        const groupedTeams = getGroupedTeams(gameData.games);
        
        res.render('index', {
            documentTitle: `OLS Viikkopelit${gameData.documentDate && gameData.documentDate !== 'Unknown' ? ' - ' + gameData.documentDate : (gameData.sourceFile ? ' (' + gameData.sourceFile + ')' : '')}`,
            groupedTeams: groupedTeams,
            selectedTeam: null,
            gamesForTeam: [],
            fieldMapData,
            loading: false
        });
    } catch (error) {
        console.error('Error loading data from database:', error);
        res.render('index', {
            documentTitle: 'OLS Viikkopelit - Error',
            groupedTeams: [],
            selectedTeam: null,
            gamesForTeam: [],
            fieldMapData,
            loading: false,
            error: 'Failed to load data from database'
        });
    }
});

app.get('/team/:teamName', async (req: Request, res: Response) => {
  const teamName = decodeURIComponent(req.params.teamName);
  
  try {
    // Initialize database if not already done
    if (!database) {
      database = await getDatabase();
    }
    
    // Get games for this team directly from database
    const teamGames = await database.getGamesForTeam(teamName);
    
    // Get all game data for grouped teams
    const allGameData = await database.getCurrentGameData();
    const groupedTeams = getGroupedTeams(allGameData.games);
    
    // Transform games to include opponent and other display logic
    let gamesForTeam = teamGames.map((game: any) => {
      const opponent = game.team1 === teamName ? game.team2 : game.team1;
      return { ...game, opponent: opponent || 'VASTUSTAJA PUUTTUU' };
    });

    // Sort games by start time
    gamesForTeam.sort((a: any, b: any) => {
      const startTimeA = getGameStartTimeInMinutes(a);
      const startTimeB = getGameStartTimeInMinutes(b);
      if (isNaN(startTimeA) || isNaN(startTimeB)) return 0; // Keep order if times are invalid
      return startTimeA - startTimeB;
    });

    // Calculate break time between games
    for (let i = 1; i < gamesForTeam.length; i++) {
      const currentGame = gamesForTeam[i] as any; // Use any to add new property
      const previousGame = gamesForTeam[i - 1];

      const previousGameEndTimeParts = previousGame.time.split(' - ');
      if (previousGameEndTimeParts.length === 2) {
          const previousGameEndTimeMinutes = parseTimeToMinutes(previousGameEndTimeParts[1]);
          const currentGameStartTimeMinutes = getGameStartTimeInMinutes(currentGame);

          if (!isNaN(previousGameEndTimeMinutes) && !isNaN(currentGameStartTimeMinutes)) {
              const breakDuration = currentGameStartTimeMinutes - previousGameEndTimeMinutes;
              if (breakDuration > 0) {
                  currentGame.breakDurationMinutes = breakDuration;
              }
          }
      }
    }

    res.render('index', { 
      documentTitle: `OLS Viikkopelit${allGameData.documentDate && allGameData.documentDate !== 'Unknown' ? ' - ' + allGameData.documentDate : ''}`, 
      groupedTeams: groupedTeams, 
      selectedTeam: teamName, 
      gamesForTeam, 
      fieldMapData,
      loading: false
    });
  } catch (error) {
    console.error('Error loading team data from database:', error);
    res.render('index', {
      documentTitle: 'OLS Viikkopelit - Error',
      groupedTeams: [],
      selectedTeam: teamName,
      gamesForTeam: [],
      fieldMapData,
      loading: false,
      error: 'Failed to load team data from database'
    });
  }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'UP', 
    service: 'main-viewer',
    database: 'shared-sqlite-readonly',
    timestamp: new Date().toISOString() 
  });
});

// Note: Admin refresh functionality removed - data flows automatically through database

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log(`⚽ Main app server running on http://localhost:${PORT}`);
    console.log(`🎉 App startup completed in ${Date.now() - appStartTime}ms`);
});
