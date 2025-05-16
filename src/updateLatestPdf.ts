import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { pipeline } from 'stream/promises';

const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';
const PDF_DOWNLOAD_SUB_DIR = 'downloaded_pdfs';
const PDF_DOWNLOAD_DIR = path.join(PERSISTENT_STORAGE_BASE_PATH, PDF_DOWNLOAD_SUB_DIR);

const TARGET_URL = 'https://ols.fi/jalkapallo/viikkopelit/';

async function ensureDirectoryExists(dirPath: string) {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        console.log(`Directory ensured: ${dirPath}`);
    } catch (error) {
        console.error(`Error creating directory ${dirPath}:`, error);
        throw error; // Re-throw to halt execution if directory can't be made
    }
}

async function downloadFile(url: string, outputPath: string) {
    console.log(`Attempting to download from URL: ${url}`);
    console.log(`Saving to path: ${outputPath}`);
    try {
        const response = await fetch(url);
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
        }
        // Node.js stream type for pipeline might need an assertion with native fetch response.body
        await pipeline(response.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(outputPath));
        console.log(`File downloaded successfully to ${outputPath}`);
    } catch (error) {
        console.error(`Error downloading file from ${url}:`, error);
        throw error;
    }
}

async function runUpdater() {
    console.log('Starting PDF update process...');
    let browser;
    try {
        // Ensure the download directory exists before launching browser or anything else
        await ensureDirectoryExists(PDF_DOWNLOAD_DIR);

        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, // For Docker, can be /usr/bin/chromium
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

        type PdfLink = {
            href: string;
            text: string;
            date?: string;
            dateObj?: Date; // Add dateObj for typed usage later
        };

        const pdfLinks: PdfLink[] = await page.evaluate(() => {
            const links: PdfLink[] = [];
            document.querySelectorAll('a').forEach(anchor => {
                if (anchor.href && anchor.href.endsWith('.pdf')) {
                    const hrefMatch = anchor.href.match(/(\d{1,2})[_.\-](\d{1,2})[_.\-](\d{4})/);
                    let dateStr: string | undefined;
                    if (hrefMatch) {
                        const day = hrefMatch[1].padStart(2, '0');
                        const month = hrefMatch[2].padStart(2, '0');
                        const year = hrefMatch[3];
                        dateStr = `${year}-${month}-${day}`; // ISO format YYYY-MM-DD
                    }
                    links.push({ href: anchor.href, text: anchor.textContent || '', date: dateStr });
                }
            });
            return links;
        });

        if (pdfLinks.length === 0) {
            console.log('No PDF links found on the page.');
            return;
        }

        const datedPdfLinks: PdfLink[] = pdfLinks
            .filter((link: PdfLink) => link.date)
            .map((link: PdfLink) => ({ ...link, dateObj: new Date(link.date!) }))
            .sort((a: PdfLink, b: PdfLink) => (b.dateObj as Date).getTime() - (a.dateObj as Date).getTime()); // Sort descending by date (most recent first)

        if (datedPdfLinks.length === 0) {
            console.log('No PDF links with recognizable dates in filenames found.');
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let selectedPdfLink = null;

        // Prefer future or current PDFs, sorted to pick the nearest future one
        const futureOrCurrentLinks: PdfLink[] = datedPdfLinks
            .filter((link: PdfLink) => link.dateObj && link.dateObj >= today)
            .sort((a: PdfLink, b: PdfLink) => (a.dateObj as Date).getTime() - (b.dateObj as Date).getTime());

        if (futureOrCurrentLinks.length > 0) {
            selectedPdfLink = futureOrCurrentLinks[0];
        } else if (datedPdfLinks.length > 0) {
            // If no future/current, pick the most recent past one (already sorted descending)
            selectedPdfLink = datedPdfLinks[0];
        }

        if (!selectedPdfLink || !selectedPdfLink.dateObj) {
            console.log('Selected PDF link is invalid or missing a date object.');
            return;
        }

        console.log(`Selected PDF: "${selectedPdfLink.text}" from ${selectedPdfLink.href} (Date: ${selectedPdfLink.dateObj.toDateString()})`);

        const pdfUrl = new URL(selectedPdfLink.href, TARGET_URL); // Resolve relative URLs
        const pdfFileName = path.basename(pdfUrl.pathname);
        const downloadPath = path.join(PDF_DOWNLOAD_DIR, pdfFileName);

        // Check if this exact PDF version (by filename) has already been processed
        // This is a simple check; you might want more sophisticated logic, e.g., checking if content changed
        // For now, we'll rely on the `extracted_games_output.json` being the source of truth for the app
        // and always download + process the selected PDF. If it's the same, processing might be redundant but harmless.

        console.log(`Downloading ${pdfUrl.href} to ${downloadPath}...`);
        await downloadFile(pdfUrl.href, downloadPath);
        console.log('Download complete.');

        console.log(`Processing ${downloadPath} with npm run process-pdf...`);
        // Ensure the path is correctly quoted if it contains spaces, though pdfFileName typically won't.
        const processCommand = `npm run process-pdf -- "${downloadPath}"`;
        
        await new Promise<void>((resolve, reject) => { // Wrap exec in a Promise
            exec(processCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Error processing PDF: ${error.message}`);
                    console.error(`Stdout: ${stdout}`);
                    console.error(`Stderr: ${stderr}`);
                    reject(error); // Reject the promise on error
                    return;
                }
                if (stderr) {
                    // pdf2json often outputs to stderr even on success, so treat as warning
                    console.warn(`Stderr while processing PDF (normal for pdf2json): ${stderr}`);
                }
                console.log(`PDF processing script stdout: ${stdout}`);
                console.log('PDF processed successfully. Application data should be updated.');
                resolve(); // Resolve the promise on success
            });
        });

    } catch (error) {
        console.error('Error in PDF update process:', error);
        throw error; // Re-throw error to be caught by the caller (e.g., the HTTP endpoint)
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log('PDF update process finished.');
    }
}

// Self-invocation check if you want to run this file directly
if (process.argv[1] && (process.argv[1].endsWith('updateLatestPdf.ts') || process.argv[1].endsWith('updateLatestPdf.js'))) {
    runUpdater().catch(console.error);
}

// Export if you want to call it from elsewhere, e.g. an HTTP endpoint
export { runUpdater }; 