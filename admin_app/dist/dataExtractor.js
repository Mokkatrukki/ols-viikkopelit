import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './database.js';
// Debug utility function
function debugLog(message, data) {
    const timestamp = new Date().toISOString();
    const logMessage = `[EXTRACTOR ${timestamp}] ${message}`;
    console.log(logMessage);
    if (data !== undefined) {
        if (typeof data === 'object') {
            console.log(JSON.stringify(data, null, 2));
        }
        else {
            console.log(data);
        }
    }
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_FILE_STORAGE_PATH || process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';
function decodeText(encodedText) {
    try {
        return decodeURIComponent(encodedText);
    }
    catch (e) {
        return encodedText;
    }
}
function groupElementsByLine(elements, yTolerance = 0.15) {
    if (!elements.length) {
        return [];
    }
    const sortedElements = [...elements].sort((a, b) => {
        if (a.y < b.y)
            return -1;
        if (a.y > b.y)
            return 1;
        if (a.x < b.x)
            return -1;
        if (a.x > b.x)
            return 1;
        return 0;
    });
    const lines = [];
    let currentLine = [sortedElements[0]];
    for (let i = 1; i < sortedElements.length; i++) {
        const currentElement = sortedElements[i];
        if (Math.abs(currentElement.y - currentLine[0].y) < yTolerance) {
            currentLine.push(currentElement);
        }
        else {
            lines.push([...currentLine].sort((a, b) => a.x - b.x));
            currentLine = [currentElement];
        }
    }
    if (currentLine.length > 0) {
        lines.push([...currentLine].sort((a, b) => a.x - b.x));
    }
    return lines;
}
function extractTextElementsFromPage(page) {
    const elements = [];
    for (const textObj of page.Texts) {
        const fullText = textObj.R.map(run => decodeText(run.T)).join('');
        if (fullText.trim()) {
            elements.push({
                text: fullText,
                x: textObj.x,
                y: textObj.y,
                w: textObj.w,
            });
        }
    }
    elements.sort((a, b) => {
        if (a.y < b.y)
            return -1;
        if (a.y > b.y)
            return 1;
        if (a.x < b.x)
            return -1;
        if (a.x > b.x)
            return 1;
        return 0;
    });
    return elements;
}
// inferYearFromTeams moved to pageParserUtils.ts
import { detectFieldNamesOnLine, initializeFieldBlocks, extractGamesFromLineForBlock } from './pageParserUtils.js'; // Added extractGamesFromLineForBlock
// New function to process lines from a page
function processPageLines(lines, pageWidth) {
    const games = [];
    let currentLeftBlock = null;
    let currentRightBlock = null;
    const isLandscape = pageWidth > 100;
    // console.log(`Page width: ${pageWidth}, Detected orientation: ${isLandscape ? 'Landscape' : 'Portrait'}`);
    const midPointX = pageWidth / 2.0;
    const fieldDetectionTolerance = isLandscape ? 0.5 : 0.2;
    let lineIndex = 0;
    while (lineIndex < lines.length) {
        const line = lines[lineIndex];
        if (line.length === 0) {
            lineIndex++;
            continue;
        }
        // Try to detect new field headers on the current line
        const { leftFieldEl, rightFieldEl } = detectFieldNamesOnLine(line, pageWidth, fieldDetectionTolerance, debugLog);
        if (leftFieldEl || rightFieldEl) {
            // If field names are found, this line is a field header line.
            // The next line should contain gameDuration, gameType, year for these fields.
            lineIndex++; // Move to the actual header data line
            if (lineIndex < lines.length) {
                const headerDataLineElements = lines[lineIndex];
                const { currentLeftBlock: newLeftBlock, currentRightBlock: newRightBlock } = initializeFieldBlocks({ leftFieldEl, rightFieldEl }, headerDataLineElements, midPointX, debugLog);
                currentLeftBlock = newLeftBlock;
                currentRightBlock = newRightBlock;
            }
            lineIndex++; // Move past the header data line
            continue; // Process next line, which should be a game line or new field headers
        }
        // If no new field headers were detected, this line should contain game data for existing blocks.
        let gamesProcessedInThisLineForRightBlock = false;
        if (currentLeftBlock) {
            const leftBlockGames = extractGamesFromLineForBlock(line, currentLeftBlock, midPointX, true, currentRightBlock, debugLog, pageWidth);
            games.push(...leftBlockGames);
            // Check if any game was reassigned to the right block (GARAM MASALA 1A -> 1B case)
            if (currentRightBlock && leftBlockGames.some((g) => g.field === currentRightBlock.name)) {
                gamesProcessedInThisLineForRightBlock = true;
            }
        }
        if (currentRightBlock && !gamesProcessedInThisLineForRightBlock) {
            const rightBlockGames = extractGamesFromLineForBlock(line, currentRightBlock, midPointX, false, null, debugLog, pageWidth);
            games.push(...rightBlockGames);
        }
        if (!currentLeftBlock && !currentRightBlock) {
            // Potentially an orphaned game line if no blocks are active
            // Consider if extractGamesFromLineForBlock should be called with some default/guessed block or if such lines are ignored
            debugLog(`Orphaned game line check (no active blocks): ${line.map(el => el.text).join(' || ')}`);
        }
        lineIndex++;
    }
    return games;
}
async function main() {
    const inputPath = path.join(PERSISTENT_STORAGE_BASE_PATH, 'parsed_pdf_data.json');
    console.log(`Reading PDF data from: ${inputPath}`);
    let rawPdfJson;
    try {
        rawPdfJson = fs.readFileSync(inputPath, 'utf-8');
    }
    catch (error) {
        console.error(`Failed to read input JSON file: ${inputPath}`, error);
        return;
    }
    let parsedData; // Add sourcePdfFile to type
    try {
        parsedData = JSON.parse(rawPdfJson);
    }
    catch (error) {
        console.error(`Failed to parse input JSON from ${inputPath}`, error);
        return;
    }
    if (!parsedData || !parsedData.Pages || parsedData.Pages.length === 0) {
        console.log('No pages found in PDF data.');
        return;
    }
    let documentDate = null;
    // Try to extract date from the first page
    if (parsedData.Pages.length > 0) {
        const firstPageTexts = extractTextElementsFromPage(parsedData.Pages[0]);
        // Regex to find dd.mm.yyyy or d.m.yyyy pattern within a string
        const dateRegex = /(\d{1,2}\.\d{1,2}\.\d{4})/;
        for (const textElement of firstPageTexts) {
            const potentialText = textElement.text.trim();
            const match = potentialText.match(dateRegex);
            if (match && match[1]) { // Check if regex matches and capturing group is found
                documentDate = match[1]; // Assign the captured date string
                console.log(`--- Found Document Date: ${documentDate} (from text: "${potentialText}") ---`);
                break; // Assuming the first match is the correct one
            }
        }
        if (!documentDate) {
            console.log("--- Document Date not found on the first page ---");
        }
    }
    const allGames = [];
    for (let i = 0; i < parsedData.Pages.length; i++) {
        const page = parsedData.Pages[i];
        console.log(`
--- Processing Page ${i + 1} ---`);
        const extractedTexts = extractTextElementsFromPage(page);
        const lines = groupElementsByLine(extractedTexts);
        const gamesFromPage = processPageLines(lines, page.Width);
        allGames.push(...gamesFromPage);
    }
    console.log(`
Extraction finished. Found ${allGames.length} games in total.`);
    if (allGames.length > 0 || documentDate) {
        console.log("\n--- Sample Extracted Games ---");
        allGames.slice(0, 5).forEach(game => console.log(game));
        // Save to database
        try {
            console.log('Saving data to database...');
            const db = await getDatabase();
            // Start a processing session
            const sourceFileName = parsedData.sourcePdfFile ? path.basename(parsedData.sourcePdfFile) : 'unknown.pdf';
            const processingId = await db.startProcessing(sourceFileName, documentDate || new Date().toISOString().split('T')[0]);
            // Convert the games to database format
            const gameData = {
                documentDate: documentDate || 'Unknown',
                games: allGames.map(game => ({
                    field: game.field,
                    time: game.time,
                    team1: game.team1 || '',
                    team2: game.team2 || '',
                    year: game.year,
                    gameDuration: game.gameDuration,
                    gameType: game.gameType
                }))
            };
            // Save games to database
            const savedCount = await db.saveGamesData(processingId, gameData);
            console.log(`Successfully saved ${savedCount} games to database`);
        }
        catch (dbError) {
            console.error('Error saving to database:', dbError);
            throw dbError; // Re-throw since database is now our primary storage
        }
    }
    else {
        console.log('No games extracted and no date found, nothing to save.');
    }
}
main().catch(console.error);
