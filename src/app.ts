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
import axios from 'axios'; // Added for making HTTP requests

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
                (prefixWords.length >= 2 && prefixWords.every(word => word.length >= 2)); // 2+ words, each 2+ chars
            
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

// Interface for base teams with their subteams
interface BaseTeam {
    name: string; // Base team name like "OLS Hollanti 20"
    subteams: string[]; // Full subteam names like "OLS Hollanti 20 Ajax"
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Health check endpoint for Fly.io
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3002;

const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';
// Path to the JSON data
const jsonDataPath = path.join(PERSISTENT_STORAGE_BASE_PATH, 'extracted_games_output.json');

interface ExtractedData {
  documentDate: string | null;
  games: GameInfo[];
  sourceFile?: string; // Optional: to store the name of the PDF it came from
}

let allGames: GameInfo[] = [];
let documentDate: string | null = null;
let sourceFile: string | null = null; // To store the source PDF filename
let cachedGroupedTeams: GroupedTeamEntry[] = [];
let cachedBaseTeams: BaseTeam[] = [];
let dataLoaded = false; // Track if data is loaded

// Function to load or reload game data
async function loadGameData() {
    const startTime = Date.now();
    console.log('🔄 Starting loadGameData()...');
    
    try {
        // Ensure the directory exists before trying to read (especially for first run)
        const dataDir = path.dirname(jsonDataPath);
        if (!fs.existsSync(dataDir)){
            fs.mkdirSync(dataDir, { recursive: true });
            console.log(`Created data directory: ${dataDir}`);
        }

        if (!fs.existsSync(jsonDataPath)) {
            console.warn(`Data file not found at ${jsonDataPath}. App will start with empty data. Run updater to generate it.`);
            allGames = [];
            documentDate = null;
            sourceFile = null;
            cachedGroupedTeams = [];
            cachedBaseTeams = [];
            dataLoaded = true;
            console.log(`⚡ loadGameData() completed in ${Date.now() - startTime}ms (no data file)`);
            return; // Exit early if file doesn't exist
        }

        const fileReadStart = Date.now();
        const fileContent = await fs.promises.readFile(jsonDataPath, 'utf-8');
        console.log(`📁 File read took ${Date.now() - fileReadStart}ms`);
        
        const parseStart = Date.now();
        const parsedData: ExtractedData = JSON.parse(fileContent);
        console.log(`🔧 JSON parse took ${Date.now() - parseStart}ms`);
        
        allGames = parsedData.games || []; // Ensure games is an array
        documentDate = parsedData.documentDate;
        sourceFile = parsedData.sourceFile || null; // Load source file if available
        
        const groupingStart = Date.now();
        cachedGroupedTeams = getGroupedTeams(allGames);
        cachedBaseTeams = getBaseTeams(allGames);
        console.log(`👥 Team grouping took ${Date.now() - groupingStart}ms`);
        
        dataLoaded = true;
        console.log('Game data and grouped teams reloaded successfully.');
        console.log(`Loaded ${allGames.length} games.`);
        if (documentDate) {
            console.log(`Document date: ${documentDate}`);
        }
        if (sourceFile) {
            console.log(`Source PDF: ${sourceFile}`);
        }
        console.log(`⚡ loadGameData() completed in ${Date.now() - startTime}ms (total)`);
    } catch (error) {
        console.error('Error reading or parsing game data:', error);
        // Don't exit, allow the app to run, maybe with a message on the page
        allGames = [];
        documentDate = null;
        sourceFile = null;
        cachedGroupedTeams = [];
        cachedBaseTeams = [];
        dataLoaded = true; // Mark as loaded even if failed, to prevent infinite loading
        console.error('Failed to load game data:', error);
        console.log(`❌ loadGameData() failed after ${Date.now() - startTime}ms`);
    }
}

console.log('🚀 Starting OLS Viikkopelit application...');
const appStartTime = Date.now();

// Start async data load (don't wait for it)
console.log('📊 Starting async game data load...');
loadGameData().catch(error => {
    console.error('� Async data loading failed:', error);
});

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
    // If data is not loaded yet, try to load it quickly
    if (!dataLoaded) {
        try {
            console.log('🔄 Data not loaded, attempting quick load...');
            await Promise.race([
                loadGameData(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
            ]);
        } catch (error) {
            console.log('⚡ Quick load failed or timed out, showing loading state');
        }
    }
    
    if (!dataLoaded) {
        // Show loading state
        res.render('index', {
            documentTitle: 'OLS Viikkopelit - Loading...',
            groupedTeams: [],
            selectedTeam: null,
            gamesForTeam: [],
            fieldMapData,
            baseTeams: [],
            loading: true
        });
        return;
    }
    
    res.render('index', {
        documentTitle: `OLS Viikkopelit${documentDate ? ' - ' + documentDate : (sourceFile ? ' (' + sourceFile + ')' : '')}`,
        groupedTeams: cachedGroupedTeams, // Use cached version
        selectedTeam: null,
        gamesForTeam: [],
        fieldMapData,
        baseTeams: cachedBaseTeams,
        loading: false
    });
});

// Admin page to refresh data from storage
app.get('/admin', (req: Request, res: Response) => {
    // This page should have a form/button that POSTs to /admin/refresh-action
    // Trying to render 'admin.ejs'. Ensure this file exists in 'views' or change to 'ops-refresh-data.ejs'.
    res.render('ops-refresh-data', {
        message: req.query.message || null,
        scheduleDate: documentDate,
        scheduleFile: sourceFile
    });
});

app.post('/admin/refresh-action', async (req: Request, res: Response) => {
    console.log('Received request to refresh game data by fetching from admin service.');
    try {
        const adminAppDataUrl = process.env.ADMIN_APP_DATA_URL;
        const apiKey = process.env.API_ACCESS_KEY;

        if (!adminAppDataUrl || !apiKey) {
            console.error('ADMIN_APP_DATA_URL or API_ACCESS_KEY is not set in environment variables.');
            // Using redirect with query parameter for consistency with the original success case
            return res.redirect('/admin?message=Failed to refresh: Admin app connection details are not configured.');
        }

        let newDataPayload: string;
        try {
            console.log(`Fetching latest data from admin app: ${adminAppDataUrl}`);
            const response = await axios.get(adminAppDataUrl, {
                headers: {
                    'X-API-Key': apiKey
                },
                timeout: 15000 // 15 second timeout for the API call
            });

            if (typeof response.data === 'object' && response.data !== null) {
                newDataPayload = JSON.stringify(response.data, null, 2);
            } else if (typeof response.data === 'string') {
                newDataPayload = response.data;
            } else {
                // Fallback for other types (e.g., number, boolean) or if response.data is null/undefined
                console.warn('Admin app response data was not an object or string, converting to string:', response.data);
                newDataPayload = String(response.data || ''); // Ensure it's a string, default to empty if null/undefined
            }
            console.log('Successfully fetched data from admin app.');

        } catch (fetchError: any) {
            console.error('Error fetching data from admin app:', fetchError.message);
            let errorDetail = fetchError.message;
            if (fetchError.response) {
                errorDetail += ` (Status: ${fetchError.response.status} - Data: ${JSON.stringify(fetchError.response.data)})`;
            }
            return res.redirect(`/admin?message=Failed to fetch new data from admin service: ${encodeURIComponent(String(errorDetail))}`);
        }

        try {
            const dataDir = path.dirname(jsonDataPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(jsonDataPath, newDataPayload, 'utf-8');
            console.log(`New data successfully written to ${jsonDataPath}`);

            await loadGameData(); // This will update global documentDate and sourceFile

            res.redirect('/admin?message=Data refreshed successfully from admin service and reloaded.');
        } catch (writeError: any) {
            console.error(`Error writing new data to ${jsonDataPath}:`, writeError.message);
            return res.redirect(`/admin?message=Failed to save new data locally: ${encodeURIComponent(String(writeError.message || 'Unknown write error'))}`);
        }
    } catch (error: any) { // General catch block for the async route handler
        console.error('Error in /admin/refresh-action route:', error.message);
        res.redirect(`/admin?message=Error during refresh process: ${encodeURIComponent(String(error.message || 'Unknown refresh error'))}`);
    }
});

// Team portal route - shows all subteams for a base team
app.get('/base-team/:baseTeamName', async (req: Request, res: Response): Promise<void> => {
  const baseTeamName = decodeURIComponent(req.params.baseTeamName);
  
  // If data is not loaded yet, try to load it quickly
  if (!dataLoaded) {
    try {
      console.log('🔄 Data not loaded for base team route, attempting quick load...');
      await Promise.race([
        loadGameData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
    } catch (error) {
      console.log('⚡ Quick load failed or timed out for base team route, showing loading state');
    }
  }
  
  if (!dataLoaded) {
    // Show loading state
    res.render('base_team_portal', {
      documentTitle: `${baseTeamName} - Joukkueportaali`,
      baseTeamName: baseTeamName,
      subteams: [],
      loading: true
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
        return { ...game, opponent: opponent || 'VASTUSTAJA PUUTTUU' };
      })
      .sort((a, b) => {
        const startTimeA = getGameStartTimeInMinutes(a);
        const startTimeB = getGameStartTimeInMinutes(b);
        if (isNaN(startTimeA) || isNaN(startTimeB)) return 0;
        return startTimeA - startTimeB;
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
    loading: false
  });
});

app.get('/team/:teamName', async (req: Request, res: Response) => {
  const teamName = decodeURIComponent(req.params.teamName);
  
  // If data is not loaded yet, try to load it quickly
  if (!dataLoaded) {
    try {
      console.log('🔄 Data not loaded for team route, attempting quick load...');
      await Promise.race([
        loadGameData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
    } catch (error) {
      console.log('⚡ Quick load failed or timed out for team route, showing loading state');
    }
  }
  
  if (!dataLoaded) {
    // Show loading state
    res.render('index', {
      documentTitle: 'OLS Viikkopelit - Loading...',
      groupedTeams: [],
      selectedTeam: teamName,
      gamesForTeam: [],
      fieldMapData,
      baseTeams: [],
      loading: true
    });
    return;
  }
  
  let gamesForTeam = allGames
    .filter(game => game.team1 === teamName || game.team2 === teamName)
    .map(game => {
      const opponent = game.team1 === teamName ? game.team2 : game.team1;
      return { ...game, opponent: opponent || 'VASTUSTAJA PUUTTUU' };
    });

  // Sort games by start time
  gamesForTeam.sort((a, b) => {
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
    documentTitle: `OLS Viikkopelit${documentDate ? ' - ' + documentDate : ''}`, 
    groupedTeams: cachedGroupedTeams, 
    selectedTeam: teamName, 
    gamesForTeam, 
    fieldMapData,
    baseTeams: cachedBaseTeams,
    loading: false
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Server is running at http://localhost:${PORT}`);
  console.log(`🏁 Total startup time: ${Date.now() - appStartTime}ms`);
}); 