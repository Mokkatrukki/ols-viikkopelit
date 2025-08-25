import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { pipeline } from 'stream/promises';
import { getDatabase } from './database.js';
const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_FILE_STORAGE_PATH || process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';
const PDF_DOWNLOAD_SUB_DIR = 'downloaded_pdfs';
const PDF_DOWNLOAD_DIR = path.join(PERSISTENT_STORAGE_BASE_PATH, PDF_DOWNLOAD_SUB_DIR);
const TARGET_URL = 'https://ols.fi/jalkapallo/viikkopelit/';
const expectedReleaseDatesStrings = [
    "6.5.2025", "8.5.2025", "15.5.2025", "22.5.2025", "29.5.2025",
    "5.6.2025", "12.6.2025", "19.6.2025", "26.6.2025", "31.7.2025",
    "7.8.2025", "14.8.2025", "21.8.2025", "28.8.2025", "4.9.2025",
    "11.9.2025", "18.9.2025"
];
// Helper function to parse D.M.YYYY string to Date object
function parseDMYStringToDate(dateString) {
    if (!dateString)
        return null;
    const parts = dateString.split('.');
    if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
        const year = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            const date = new Date(year, month, day);
            date.setHours(0, 0, 0, 0); // Normalize to start of day
            return date;
        }
    }
    return null;
}
// Helper function to format Date to D.M.YYYY string
function formatDateToDMY(date) {
    if (!date)
        return 'N/A';
    return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
}
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        console.log(`Directory ensured: ${dirPath}`);
    }
    catch (error) {
        console.error(`Error creating directory ${dirPath}:`, error);
        throw error; // Re-throw to halt execution if directory can't be made
    }
}
async function downloadFile(url, outputPath) {
    console.log(`Attempting to download from URL: ${url}`);
    console.log(`Saving to path: ${outputPath}`);
    try {
        const response = await fetch(url);
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
        }
        // Node.js stream type for pipeline might need an assertion with native fetch response.body
        await pipeline(response.body, fs.createWriteStream(outputPath));
        console.log(`File downloaded successfully to ${outputPath}`);
    }
    catch (error) {
        console.error(`Error downloading file from ${url}:`, error);
        throw error;
    }
}
async function runUpdater(currentLoadedScheduleDateString, forceUpdate = false) {
    console.log(`Starting PDF update process. Current schedule date from app: ${currentLoadedScheduleDateString}`);
    let browser;
    const currentLoadedScheduleDateObj = parseDMYStringToDate(currentLoadedScheduleDateString || '');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expectedReleaseDates = expectedReleaseDatesStrings.map(parseDMYStringToDate).filter(d => d !== null);
    // Find the latest expected release date that is on or before today
    const relevantExpectedDates = expectedReleaseDates.filter(d => d <= today);
    let latestRelevantExpectedDate = null;
    if (relevantExpectedDates.length > 0) {
        latestRelevantExpectedDate = new Date(Math.max(...relevantExpectedDates.map(d => d.getTime())));
    }
    if (currentLoadedScheduleDateObj && latestRelevantExpectedDate) {
        if (currentLoadedScheduleDateObj >= latestRelevantExpectedDate) {
            // Current schedule meets or exceeds the latest past/current expected release.
            // Log this, but proceed to check the website for any newer versions regardless.
            const message = `Current schedule (${formatDateToDMY(currentLoadedScheduleDateObj)}) meets/exceeds latest past/current expectation (${formatDateToDMY(latestRelevantExpectedDate)}). Proceeding to check website.`;
            console.log(message);
        }
        else {
            // Current schedule is older than the latest past/current expected release. Definitely check website.
            console.log(`Current schedule (${formatDateToDMY(currentLoadedScheduleDateObj)}) is older than latest past/current expectation (${formatDateToDMY(latestRelevantExpectedDate)}). Proceeding to check website.`);
        }
    }
    else if (!currentLoadedScheduleDateObj && latestRelevantExpectedDate) {
        // No current data, but there is an expectation. Proceed to check.
        console.log('No current schedule data available, but expected schedules exist. Proceeding to check website.');
    }
    else if (!latestRelevantExpectedDate) {
        // No expected releases yet based on today's date (e.g. very early in season).
        // In this specific case, we can skip the website check.
        const message = `No past or current expected PDF release dates found as of ${formatDateToDMY(today)}. No website check will be performed.`;
        console.log(message);
        return { status: 'initial-check-no-current-data', message, newScheduleDate: currentLoadedScheduleDateString, newSourceFile: null };
    }
    // If we've reached here, we proceed to launch Puppeteer and check the website.
    try {
        await ensureDirectoryExists(PDF_DOWNLOAD_DIR);
        console.log('Launching browser to check OLS website...');
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            timeout: 60000 // Increased timeout to 60 seconds
        });
        const page = await browser.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });
        const pdfLinks = await page.evaluate(() => {
            const links = [];
            document.querySelectorAll('a').forEach(anchor => {
                if (anchor.href && anchor.href.endsWith('.pdf')) {
                    // Regex to find dates like 1.5.2024 or 01-05-2024 or 1_5_24 in filenames
                    // For example: OLS_Viikkopelit_06.05.2024.pdf or Viikkopelit_SarjaX_15_5_2024_OLS.pdf
                    // This will capture day, month, year. Using new RegExp for clarity with escapes.
                    const hrefMatch = anchor.href.match(new RegExp('(\\d{1,2})[._-](\\d{1,2})[._-](\\d{4})'));
                    let dateStr;
                    if (hrefMatch) {
                        const day = hrefMatch[1].padStart(2, '0');
                        const month = hrefMatch[2].padStart(2, '0');
                        const year = hrefMatch[3];
                        // Convert to YYYY-MM-DD for easier Date construction and reliable parsing
                        dateStr = `${year}-${month}-${day}`;
                    }
                    links.push({ href: anchor.href, text: anchor.textContent || '', date: dateStr });
                }
            });
            return links;
        });
        if (pdfLinks.length === 0) {
            const message = 'No PDF links found on the page.';
            console.log(message);
            return { status: 'no-pdf-found-on-site', message };
        }
        const datedPdfLinks = pdfLinks
            .filter((link) => link.date)
            .map((link) => {
            const dateObj = new Date(link.date); // link.date is YYYY-MM-DD
            dateObj.setHours(0, 0, 0, 0);
            return { ...link, dateObj };
        })
            .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
        if (datedPdfLinks.length === 0) {
            const message = 'No PDF links with recognizable dates in filenames found.';
            console.log(message);
            return { status: 'no-pdf-found-on-site', message };
        }
        // Select the most recent PDF based on its filename date (already sorted: datedPdfLinks[0])
        const selectedPdfLink = datedPdfLinks[0];
        const latestPdfDateOnWebsite = selectedPdfLink.dateObj;
        if (!latestPdfDateOnWebsite) {
            const message = 'Could not determine date for the latest PDF on website.';
            console.log(message);
            return { status: 'no-pdf-found-on-site', message };
        }
        console.log(`Latest PDF on website: \"${selectedPdfLink.text}\" from ${selectedPdfLink.href} (Date: ${formatDateToDMY(latestPdfDateOnWebsite)})`);
        if (!forceUpdate && currentLoadedScheduleDateObj && latestPdfDateOnWebsite <= currentLoadedScheduleDateObj) {
            const message = `The latest PDF on the website (${formatDateToDMY(latestPdfDateOnWebsite)}) is not newer than the current schedule (${formatDateToDMY(currentLoadedScheduleDateObj)}).`;
            console.log(message);
            return { status: 'no-newer-on-website', message, newScheduleDate: currentLoadedScheduleDateString, newSourceFile: null /* App still has old one */ };
        }
        if (forceUpdate && currentLoadedScheduleDateObj && latestPdfDateOnWebsite <= currentLoadedScheduleDateObj) {
            console.log(`Force update enabled. Proceeding with update even though the PDF date (${formatDateToDMY(latestPdfDateOnWebsite)}) is not newer than the current schedule (${formatDateToDMY(currentLoadedScheduleDateObj)}).`);
        }
        const pdfUrl = new URL(selectedPdfLink.href, TARGET_URL);
        const pdfFileName = path.basename(pdfUrl.pathname);
        const downloadPath = path.join(PDF_DOWNLOAD_DIR, pdfFileName);
        console.log(`Downloading ${pdfUrl.href} to ${downloadPath}...`);
        await downloadFile(pdfUrl.href, downloadPath);
        console.log('Download complete.');
        console.log(`Processing ${downloadPath} with npm run parse-pdf...`);
        const processCommand = `npm run parse-pdf -- "${downloadPath}"`; // Uses script from admin_app/package.json
        await new Promise((resolve, reject) => {
            exec(processCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error processing PDF: ${error.message}`);
                    console.error(`Stdout: ${stdout}`);
                    console.error(`Stderr: ${stderr}`);
                    reject(error);
                    return;
                }
                if (stderr) {
                    console.warn(`Stderr while processing PDF (normal for pdf2json): ${stderr}`);
                }
                console.log(`PDF processing script stdout: ${stdout}`);
                console.log('PDF processed successfully.');
                resolve();
            });
        });
        // After successful processing, read the new documentDate and sourceFile
        // from the database to confirm and return to the caller.
        let newExtractedData = { documentDate: null };
        try {
            const db = await getDatabase();
            const gameData = await db.exportGamesAsJSON();
            newExtractedData = {
                documentDate: gameData.documentDate,
                sourceFile: pdfFileName
            };
        }
        catch (readError) {
            console.error(`Error reading from database after update:`, readError);
            // Fallback or decide how to handle; for now, it means we can't confirm new date/file
        }
        const successMessage = `Schedule updated successfully using ${pdfFileName}. New schedule date: ${newExtractedData.documentDate || 'Unknown'}.`;
        console.log(successMessage);
        return {
            status: 'updated',
            message: successMessage,
            newScheduleDate: newExtractedData.documentDate,
            newSourceFile: newExtractedData.sourceFile || pdfFileName
        };
    }
    catch (error) {
        console.error('Error in PDF update process:', error);
        return { status: 'error', message: error.message || 'Unknown error in runUpdater', newScheduleDate: null, newSourceFile: null };
    }
    finally {
        if (browser) {
            await browser.close();
        }
        console.log('PDF update process finished.');
    }
}
// Self-invocation check (modified to reflect new signature, mostly for testing)
if (process.argv[1] && (process.argv[1].endsWith('updateLatestPdf.ts') || process.argv[1].endsWith('updateLatestPdf.js'))) {
    console.log('Running updateLatestPdf.ts directly for testing...');
    // Example: run with null for current date, or a specific date string like "5.5.2025"
    runUpdater(null).then(result => {
        console.log('Direct run completed. Result:', result);
    }).catch(console.error);
}
// Export if you want to call it from elsewhere, e.g. an HTTP endpoint
export { runUpdater, expectedReleaseDatesStrings, parseDMYStringToDate, formatDateToDMY };
