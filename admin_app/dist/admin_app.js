import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runUpdater } from './updateLatestPdf.js';
import fs from 'fs/promises'; // Using promises API for fs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3003;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views')); // Point to admin_app/views
const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || path.join(__dirname, '../../../persistent_app_files'); // Adjust path for admin_app's location relative to root for local dev
const EXTRACTED_GAMES_OUTPUT_PATH = path.join(PERSISTENT_STORAGE_BASE_PATH, 'extracted_games_output.json');
app.use(express.static(path.join(__dirname, '../public'))); // Serve static files from admin_app/public
app.use(express.urlencoded({ extended: true })); // For parsing form data
// Admin dashboard page
app.get('/', (req, res) => {
    res.render('admin_dashboard', { message: null });
});
// Endpoint to trigger the data update process
app.post('/trigger-full-update', async (req, res) => {
    console.log('Received request to trigger full data update.');
    try {
        let currentScheduleDateString = null;
        try {
            const fileContent = await fs.readFile(EXTRACTED_GAMES_OUTPUT_PATH, 'utf-8');
            const parsedData = JSON.parse(fileContent);
            currentScheduleDateString = parsedData.documentDate || null;
            console.log(`Current schedule date from JSON: ${currentScheduleDateString}`);
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                console.log('extracted_games_output.json not found. Assuming no current schedule.');
            }
            else {
                console.warn('Could not read or parse existing extracted_games_output.json:', err);
            }
            // Proceed with null currentScheduleDateString if file doesn't exist or is invalid
        }
        const result = await runUpdater(currentScheduleDateString);
        console.log('Update process finished:', result);
        res.render('admin_dashboard', { message: `Update result: ${result.status} - ${result.message}. New schedule date: ${result.newScheduleDate || 'N/A'}` });
    }
    catch (error) {
        console.error('Error during data update process:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).render('admin_dashboard', { message: `Error during update: ${errorMessage}` });
    }
});
app.listen(PORT, () => {
    console.log(`Admin app server running on http://localhost:${PORT}`);
});
