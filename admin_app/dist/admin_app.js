import 'dotenv/config'; // Load .env file variables
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runUpdater } from './updateLatestPdf.js';
import { generateDataSummary, checkDataIssues } from './gameDataExtractor.js';
import uploadRoutes from './routes/uploadRoutes.js';
import { getDatabase } from './database.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
// Health check endpoint for Fly.io
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});
const PORT = process.env.PORT || 8081;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views')); // Point to admin_app/views
const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_FILE_STORAGE_PATH || process.env.APP_PERSISTENT_STORAGE_PATH || path.join(__dirname, '../persistent_app_files'); // Path to file storage for file operations
app.use(express.static(path.join(__dirname, '../public'))); // Serve static files from admin_app/public
app.use(express.urlencoded({ extended: true })); // For parsing form data
// Admin dashboard page
app.get('/', (req, res) => {
    const message = req.query.message || null;
    const messageType = req.query.type || (message ? 'info' : null); // 'info', 'success', 'error'
    res.render('admin_dashboard', { message, messageType });
});
// Data check page
app.get('/check-data', async (req, res) => {
    const filterType = req.query.filter === 'removeNoOpponent' ? 'removeNoOpponent' : null;
    let viewTitle = 'OLS Viikkopelit - Tietojen tarkistus';
    if (filterType === 'removeNoOpponent') {
        viewTitle = 'OLS Viikkopelit - Tietojen tarkistus (Suodatettu: Ei vastustajaa vs Ei vastustajaa -ottelut poistettu)';
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
    }
    catch (error) {
        console.error('Error generating data summary:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).render('admin_dashboard', {
            message: `Virhe tarkistettaessa tietoja: ${errorMessage}`
        });
    }
});
// Endpoint to trigger the data update process
app.post('/trigger-full-update', async (req, res) => {
    const forceUpdate = req.body.forceUpdate === 'on';
    console.log(`Received request to trigger full data update. Force update: ${forceUpdate}`);
    try {
        let currentScheduleDateString = null;
        try {
            // Get current schedule date from database
            const db = await getDatabase();
            const gameData = await db.exportGamesAsJSON();
            currentScheduleDateString = gameData.documentDate || null;
            console.log(`Current schedule date from database: ${currentScheduleDateString}`);
        }
        catch (err) {
            console.log('Could not read current schedule from database. Assuming no current schedule.');
            // Proceed with null currentScheduleDateString if database read fails
        }
        const result = await runUpdater(currentScheduleDateString, forceUpdate);
        console.log('Update process finished:', result);
        res.render('admin_dashboard', { message: `Päivityksen tulos: ${result.status} - ${result.message}. Uuden otteluohjelman päivämäärä: ${result.newScheduleDate || 'Ei saatavilla'}` });
    }
    catch (error) {
        console.error('Error during data update process:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).render('admin_dashboard', { message: `Virhe päivityksessä: ${errorMessage}` });
    }
});
// API Endpoint to serve the latest games data
const API_ACCESS_KEY = process.env.API_ACCESS_KEY;
if (!API_ACCESS_KEY) {
    console.warn('WARNING: API_ACCESS_KEY environment variable is not set. API endpoint will not be secure.');
}
app.get('/api/internal/latest-games-data', async (req, res) => {
    const providedApiKey = req.headers['x-api-key'];
    if (!API_ACCESS_KEY || API_ACCESS_KEY === 'SUPER_SECRET_ADMIN_KEY_PLACEHOLDER_NEVER_USE_IN_PROD') {
        // Log a warning if the key is not set or is the default placeholder, but allow access for local dev if not set.
        // In a real production scenario with a set key, this check would be stricter.
        if (process.env.NODE_ENV === 'production' && (!API_ACCESS_KEY || API_ACCESS_KEY === 'SUPER_SECRET_ADMIN_KEY_PLACEHOLDER_NEVER_USE_IN_PROD')) {
            console.error('API_ACCESS_KEY is not set or is insecure in production. Denying API access.');
            return res.status(500).send('API-avainta ei ole asetettu turvallisesti.');
        }
        if (process.env.NODE_ENV === 'production' && providedApiKey !== API_ACCESS_KEY) {
            console.warn('Invalid or missing API key attempt in production.');
            return res.status(403).send('Pääsy estetty: Virheellinen API-avain.');
        }
    }
    else if (providedApiKey !== API_ACCESS_KEY) {
        console.warn(`Attempt to access API with invalid key: ${providedApiKey}`);
        return res.status(403).send('Pääsy estetty: Virheellinen API-avain.');
    }
    try {
        // Get data from database
        const db = await getDatabase();
        const gameData = await db.exportGamesAsJSON();
        res.setHeader('Content-Type', 'application/json');
        res.json(gameData);
        console.log(`Served ${gameData.games.length} games from database via API`);
    }
    catch (error) {
        console.error('Error reading games data from database:', error);
        return res.status(500).send('Sisäinen palvelinvirhe: Tietokannan lukuvirhe.');
    }
});
// Mount the upload routes
app.use('/admin', uploadRoutes);
app.listen(PORT, () => {
    console.log(`Admin app server running on http://localhost:${PORT}`);
});
