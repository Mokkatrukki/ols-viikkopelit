import 'dotenv/config'; // Load .env file variables
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runUpdater, UpdateResult } from './updateLatestPdf.js';
import { generateDataSummary, checkDataIssues } from './gameDataExtractor.js';
import fs from 'fs/promises'; // Using promises API for fs
import uploadRoutes from './routes/uploadRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Health check endpoint for Fly.io
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3003;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views')); // Point to admin_app/views

const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || path.join(__dirname, '../persistent_app_files'); // Path to admin_app/persistent_app_files for local dev
const EXTRACTED_GAMES_OUTPUT_PATH = path.join(PERSISTENT_STORAGE_BASE_PATH, 'extracted_games_output.json');
app.use(express.static(path.join(__dirname, '../public'))); // Serve static files from admin_app/public
app.use(express.urlencoded({ extended: true })); // For parsing form data

// Admin dashboard page
app.get('/', (req: Request, res: Response) => {
    res.render('admin_dashboard', { message: null });
});

// Data check page
app.get('/check-data', async (req: Request, res: Response) => {
    const filterType = req.query.filter === 'removeNoOpponent' ? 'removeNoOpponent' : null;
    let viewTitle = 'OLS Viikkopelit - Data Check';
    if (filterType === 'removeNoOpponent') {
      viewTitle = 'OLS Viikkopelit - Data Check (Filtered: No Opponent vs No Opponent Removed)';
    }
    try {
        const summary = await generateDataSummary(PERSISTENT_STORAGE_BASE_PATH, filterType);
        const dataCheckResult = await checkDataIssues(PERSISTENT_STORAGE_BASE_PATH);
        
        const totalScheduledSlots = summary.totalGames;
        const activeGames = totalScheduledSlots - dataCheckResult.missingTeamGamesCount;

        res.render('data_check', {
            viewTitle,
            documentDate: summary.documentDate,
            activeGames: activeGames,
            totalScheduledSlots: totalScheduledSlots,
            missingTeamGamesCount: dataCheckResult.missingTeamGamesCount,
            totalFields: summary.totalFields,
            fieldSummaries: summary.fieldSummaries,
            issues: dataCheckResult.issues
        });
    } catch (error) {
        console.error('Error generating data summary:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).render('admin_dashboard', { 
            message: `Error checking data: ${errorMessage}` 
        });
    }
});

// Endpoint to trigger the data update process
app.post('/trigger-full-update', async (req: Request, res: Response) => {
    const forceUpdate = req.body.forceUpdate === 'on';
    console.log(`Received request to trigger full data update. Force update: ${forceUpdate}`);
    try {
        let currentScheduleDateString: string | null = null;
        try {
            const fileContent = await fs.readFile(EXTRACTED_GAMES_OUTPUT_PATH, 'utf-8');
            const parsedData = JSON.parse(fileContent);
            currentScheduleDateString = parsedData.documentDate || null;
            console.log(`Current schedule date from JSON: ${currentScheduleDateString}`);
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                console.log('extracted_games_output.json not found. Assuming no current schedule.');
            } else {
                console.warn('Could not read or parse existing extracted_games_output.json:', err);
            }
            // Proceed with null currentScheduleDateString if file doesn't exist or is invalid
        }

        const result: UpdateResult = await runUpdater(currentScheduleDateString, forceUpdate);
        console.log('Update process finished:', result);
        res.render('admin_dashboard', { message: `Update result: ${result.status} - ${result.message}. New schedule date: ${result.newScheduleDate || 'N/A'}` });
    } catch (error) {
        console.error('Error during data update process:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).render('admin_dashboard', { message: `Error during update: ${errorMessage}` });
    }
});

// API Endpoint to serve the latest games data
const API_ACCESS_KEY = process.env.API_ACCESS_KEY;

if (!API_ACCESS_KEY) {
    console.warn('WARNING: API_ACCESS_KEY environment variable is not set. API endpoint will not be secure.');
}

app.get('/api/internal/latest-games-data', async (req: Request, res: Response) => {
    const providedApiKey = req.headers['x-api-key'];

    if (!API_ACCESS_KEY || API_ACCESS_KEY === 'SUPER_SECRET_ADMIN_KEY_PLACEHOLDER_NEVER_USE_IN_PROD') {
        // Log a warning if the key is not set or is the default placeholder, but allow access for local dev if not set.
        // In a real production scenario with a set key, this check would be stricter.
        if (process.env.NODE_ENV === 'production' && (!API_ACCESS_KEY || API_ACCESS_KEY === 'SUPER_SECRET_ADMIN_KEY_PLACEHOLDER_NEVER_USE_IN_PROD')) {
             console.error('API_ACCESS_KEY is not set or is insecure in production. Denying API access.');
             return res.status(500).send('API not configured securely.');
        }
        if (process.env.NODE_ENV === 'production' && providedApiKey !== API_ACCESS_KEY) {
            console.warn('Invalid or missing API key attempt in production.');
            return res.status(403).send('Forbidden: Invalid API Key');
        }
    } else if (providedApiKey !== API_ACCESS_KEY) {
        console.warn(`Attempt to access API with invalid key: ${providedApiKey}`);
        return res.status(403).send('Forbidden: Invalid API Key');
    }

    try {
        const fileContent = await fs.readFile(EXTRACTED_GAMES_OUTPUT_PATH, 'utf-8');
        // const jsonData = JSON.parse(fileContent); // No need to parse, send raw content
        res.setHeader('Content-Type', 'application/json');
        res.send(fileContent);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.error('Error serving latest games data: extracted_games_output.json not found.');
            return res.status(404).send('Not Found: Games data file does not exist.');
        } else {
            console.error('Error reading games data file for API:', error);
            return res.status(500).send('Internal Server Error');
        }
    }
});

// Mount the upload routes
app.use('/admin', uploadRoutes);

app.listen(PORT, () => {
    console.log(`Admin app server running on http://localhost:${PORT}`);
});
