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
import { runUpdater, UpdateResult, expectedReleaseDatesStrings, parseDMYStringToDate, formatDateToDMY } from './updateLatestPdf.js';

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

// Define fieldMapData here
const fieldMapData: { [key: string]: string } = {
    "HEINÄPÄÄN TEKONURMI A": '/images/tekonurmi_map_kentta_a.png',
    "HEINÄPÄÄN TEKONURMI B": '/images/tekonurmi_map_kentta_b.png',
    "HEINÄPÄÄN TEKONURMI C": '/images/tekonurmi_map_kentta_c.png',
    "HEINÄPÄÄN TEKONURMI D": '/images/tekonurmi_map_kentta_d.png',

    "GARAM MASALA 1A": '/images/garam_masala_map_kentta_1a.png',
    "GARAM MASALA 1B": '/images/garam_masala_map_kentta_1b.png',
    "GARAM MASALA 1C": '/images/garam_masala_map_kentta_1c.png',
    "GARAM MASALA 1D": '/images/garam_masala_map_kentta_1d.png',
    "GARAM MASALA 2A": '/images/garam_masala_map_kentta_2a.png',
    "GARAM MASALA 2B": '/images/garam_masala_map_kentta_2b.png',
    "GARAM MASALA 2C": '/images/garam_masala_map_kentta_2c.png',
    "GARAM MASALA 2D": '/images/garam_masala_map_kentta_2d.png',

    "GARAM 2A": '/images/garam_masala_map_kentta_2a.png',
    "GARAM 2B": '/images/garam_masala_map_kentta_2b.png',

    // Add mappings for NURMI fields
    "NURMI 4A": '/images/nurmi_map_kentta_4a.png',
    "NURMI 4B": '/images/nurmi_map_kentta_4b.png',
    "NURMI 4C": '/images/nurmi_map_kentta_4c.png',
    "NURMI 4D": '/images/nurmi_map_kentta_4d.png',

    "HEPA - HALLI A": '/images/heinapaan_halli_map_kentta_a.png',
    "HEPA - HALLI B": '/images/heinapaan_halli_map_kentta_b.png',
    "HEPA - HALLI C": '/images/heinapaan_halli_map_kentta_c.png',
    "HEPA - HALLI D": '/images/heinapaan_halli_map_kentta_d.png'
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

// Function to load or reload game data
function loadGameData() {
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
            return; // Exit early if file doesn't exist
        }

        const fileContent = fs.readFileSync(jsonDataPath, 'utf-8');
        const parsedData: ExtractedData = JSON.parse(fileContent);
        allGames = parsedData.games || []; // Ensure games is an array
        documentDate = parsedData.documentDate;
        sourceFile = parsedData.sourceFile || null; // Load source file if available

        console.log(`Successfully loaded ${allGames.length} games.`);
        if (documentDate) {
            console.log(`Document date: ${documentDate}`);
        }
        if (sourceFile) {
            console.log(`Source PDF: ${sourceFile}`);
        }
    } catch (error) {
        console.error('Error reading or parsing game data:', error);
        // Don't exit, allow the app to run, maybe with a message on the page
        allGames = [];
        documentDate = null;
        sourceFile = null;
        console.log('Proceeding with empty game data.');
    }
}

// Initial data load
loadGameData();

// Set view engine to EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views')); // Assuming views are in project_root/views

// Serve static files (CSS, images, etc.)
app.use(express.static(path.join(__dirname, '..', 'public')));
// Middleware to parse URL-encoded bodies (for form submissions)
app.use(express.urlencoded({ extended: true }));

app.get('/', (req: Request, res: Response) => {
  const groupedTeams = getGroupedTeams(allGames);
  res.render('index', { 
    documentTitle: `OLS Viikkopelit${documentDate ? ' - ' + documentDate : (sourceFile ? ' (' + sourceFile + ')' : '')}`,
    groupedTeams, 
    selectedTeam: null, 
    gamesForTeam: [], 
    fieldMapData 
  });
});

// Admin page route
app.get('/admin', (req: Request, res: Response) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expectedDates = expectedReleaseDatesStrings.map(s => parseDMYStringToDate(s)).filter(d => d !== null) as Date[];
    
    let nextExpectedDate: Date | null = null;
    for (const date of expectedDates.sort((a, b) => a.getTime() - b.getTime())) {
        if (date >= today) {
            nextExpectedDate = date;
            break;
        }
    }
    if (!nextExpectedDate && expectedDates.length > 0) { // If all are in the past, show the last one as "last known"
        nextExpectedDate = expectedDates[expectedDates.length - 1];
    }

    // Message from a previous update attempt will be handled by client-side JS if it makes the call
    // Or if the page is loaded directly with a query param (e.g. after an error that reloads page from server-side redirect)
    let statusMessage = req.query.updateMessage as string || null; 

    res.render('admin', {
        scheduleDate: documentDate, 
        scheduleFile: sourceFile, 
        nextExpectedDateFormatted: nextExpectedDate ? formatDateToDMY(nextExpectedDate) : "N/A",
        todayFormatted: formatDateToDMY(today),
        initialUpdateMessage: statusMessage, // Pass any initial message for direct loads
        // For client-side updates, we'll also need the current data available to JS
        currentScheduleDataForClient: {
            scheduleDate: documentDate,
            scheduleFile: sourceFile
        }
    });
});

// Trigger PDF update endpoint (for manual updates from admin page)
// Now returns JSON instead of redirecting
app.post('/trigger-pdf-update', async (req: Request, res: Response): Promise<void> => {
    console.log('Received request to update PDF schedule via /trigger-pdf-update (manual).');
    try {
        const result: UpdateResult = await runUpdater(documentDate); 
        console.log('Manual runUpdater completed. Result:', result);

        let newScheduleDate = documentDate;
        let newSourceFile = sourceFile;

        if (result.status === 'updated') {
            loadGameData(); // Reload data only if an update occurred
            newScheduleDate = documentDate; // an global variables that loadGameData updates
            newSourceFile = sourceFile; // an global variables that loadGameData updates
            console.log('Game data reloaded due to manual update.');
        }
        
        res.status(200).json({ 
            status: result.status, 
            message: result.message, 
            // Send back the potentially updated schedule info
            updatedScheduleDate: newScheduleDate, 
            updatedSourceFile: newSourceFile
        });
        return;

    } catch (error: any) { 
        console.error('Error during manual PDF update process triggered by endpoint:', error);
        const errorMessage = `Failed to update PDF: ${error.message || 'Unknown error'}`;
        res.status(500).json({ 
            status: 'error', 
            message: errorMessage, 
            updatedScheduleDate: documentDate, // Send current data on error
            updatedSourceFile: sourceFile 
        });
        return;
    }
});

// Force re-process current PDF endpoint (for when extraction logic has been updated)
app.post('/force-reprocess-current-pdf', async (req: Request, res: Response): Promise<void> => {
    console.log('Received request to force re-process current PDF via /force-reprocess-current-pdf.');
    
    if (!sourceFile) {
        const errorMessage = 'No current PDF file to re-process. Please update schedule first.';
        console.log(errorMessage);
        res.status(400).json({ 
            status: 'error', 
            message: errorMessage,
            updatedScheduleDate: documentDate,
            updatedSourceFile: sourceFile
        });
        return;
    }

    try {
        // Find the current PDF file in the downloaded_pdfs directory
        const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';
        const PDF_DOWNLOAD_DIR = path.join(PERSISTENT_STORAGE_BASE_PATH, 'downloaded_pdfs');
        const currentPdfPath = path.join(PDF_DOWNLOAD_DIR, sourceFile);
        
        // Check if the file exists
        if (!fs.existsSync(currentPdfPath)) {
            const errorMessage = `Current PDF file not found at ${currentPdfPath}. Cannot re-process.`;
            console.error(errorMessage);
            res.status(404).json({ 
                status: 'error', 
                message: errorMessage,
                updatedScheduleDate: documentDate,
                updatedSourceFile: sourceFile
            });
            return;
        }

        console.log(`Force re-processing ${currentPdfPath}...`);
        const processCommand = `npm run process-pdf -- "${currentPdfPath}"`;
        
        await new Promise<void>((resolve, reject) => {
            exec(processCommand, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    console.error(`Error re-processing PDF: ${error.message}`);
                    console.error(`Stdout: ${stdout}`);
                    console.error(`Stderr: ${stderr}`);
                    reject(error);
                    return;
                }
                if (stderr) {
                    console.warn(`Stderr while re-processing PDF (normal for pdf2json): ${stderr}`);
                }
                console.log(`PDF re-processing script stdout: ${stdout}`);
                console.log('PDF re-processed successfully.');
                resolve();
            });
        });

        // Reload the game data after re-processing
        loadGameData();
        console.log('Game data reloaded after force re-processing.');

        const successMessage = `Successfully re-processed ${sourceFile} with updated extraction logic.`;
        res.status(200).json({ 
            status: 'reprocessed', 
            message: successMessage,
            updatedScheduleDate: documentDate,
            updatedSourceFile: sourceFile
        });
        return;

    } catch (error: any) { 
        console.error('Error during force re-processing:', error);
        const errorMessage = `Failed to re-process PDF: ${error.message || 'Unknown error'}`;
        res.status(500).json({ 
            status: 'error', 
            message: errorMessage,
            updatedScheduleDate: documentDate,
            updatedSourceFile: sourceFile
        });
        return;
    }
});

// New endpoint for scheduled updates (e.g., via cron job)
app.post('/execute-scheduled-update', async (req: Request, res: Response): Promise<void> => {
    console.log('Received request for scheduled PDF update via /execute-scheduled-update.');
    const today = new Date();
    const dayOfWeek = today.getDay(); // Sunday = 0, Monday = 1, ..., Saturday = 6

    // Check if it's Monday (dayOfWeek === 1)
    if (dayOfWeek !== 1) {
        const message = `Skipping scheduled update: Today is not Monday (Day: ${dayOfWeek}). Scheduled updates run only on Mondays.`;
        console.log(message);
        // Send a specific status that indicates skipping, but not an error for the cron job
        res.status(200).send({ status: 'skipped_not_monday', message }); 
        return;
    }

    console.log('Proceeding with scheduled update as it is Monday.');
    try {
        const result: UpdateResult = await runUpdater(documentDate);
        console.log('Scheduled runUpdater completed. Result:', result);

        if (result.status === 'updated') {
            loadGameData();
            console.log('Game data reloaded due to scheduled update.');
        }
        
        // For a cron job, a JSON response is usually more helpful than a redirect
        res.status(200).send({ status: result.status, message: result.message, newScheduleDate: result.newScheduleDate, newSourceFile: result.newSourceFile });
        return;

    } catch (error: any) { // Catch errors from runUpdater
        console.error('Error during scheduled PDF update process:', error);
        const errorMessage = `Failed to execute scheduled PDF update: ${error.message || 'Unknown error'}`;
        // Explicitly return the response
        res.status(500).send({ status: 'error', message: errorMessage });
        return;
    }
});

app.get('/team/:teamName', (req: Request, res: Response) => {
  const teamName = decodeURIComponent(req.params.teamName);
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

  const groupedTeams = getGroupedTeams(allGames);

  res.render('index', { documentTitle: `OLS Viikkopelit${documentDate ? ' - ' + documentDate : ''}`, groupedTeams, selectedTeam: teamName, gamesForTeam, fieldMapData });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
}); 