import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';
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
// Function to infer year from team names
function inferYearFromTeams(team1, team2) {
    const teams = [team1, team2].filter(t => t.trim());
    for (const team of teams) {
        // Look for year patterns in team names
        if (team.includes(' 17 ')) {
            return '2017 A'; // Default to A, could be A/B/C
        }
        if (team.includes(' 19 ')) {
            return '2019 VP';
        }
        if (team.includes(' 20 ')) {
            return '2020 / 2019 EP';
        }
    }
    return null;
}
// New function to process lines from a page
function processPageLines(lines, pageWidth) {
    const games = [];
    let currentLeftBlock = null;
    let currentRightBlock = null;
    // For landscape PDFs, we need to adjust our midpoint calculation
    // Check if the page is likely in landscape orientation
    const isLandscape = pageWidth > 100; // Typical landscape width is larger
    console.log(`Page width: ${pageWidth}, Detected orientation: ${isLandscape ? 'Landscape' : 'Portrait'}`);
    // Adjust midpoint based on orientation
    const midPointX = pageWidth / 2.0;
    // Improved field detection for adjacent fields
    const fieldDetectionTolerance = isLandscape ? 0.5 : 0.2; // More tolerance in landscape mode
    let lineIndex = 0;
    while (lineIndex < lines.length) {
        const line = lines[lineIndex];
        if (line.length === 0) {
            lineIndex++;
            continue;
        }
        // Enhanced field name detection with more flexible matching
        debugLog(`Analyzing line for field names with ${line.length} elements`);
        // Debug all text elements in this line
        line.forEach((el, idx) => {
            const text = el.text.trim();
            debugLog(`Line element ${idx}: "${text}" at x:${el.x.toFixed(2)}, y:${el.y.toFixed(2)}, w:${el.w.toFixed(2)}`);
        });
        // Special debug for GARAM MASALA 1B
        const masala1BElements = line.filter(el => {
            const text = el.text.trim();
            return text.includes("GARAM MASALA 1B") || text === "MASALA 1B" || text === "GARAM MASALA 1B";
        });
        if (masala1BElements.length > 0) {
            debugLog(`FOUND GARAM MASALA 1B in current line!`, masala1BElements);
        }
        // Enhanced field detection - first pass to identify all potential field names
        const potentialFieldElements = line.map((el, idx) => {
            const text = el.text.trim();
            // Check if this is a field name using various patterns
            const isFieldName = (
            // Match GARAM MASALA with more flexibility
            text.includes("GARAM MASALA") ||
                // Match specific GARAM MASALA fields with numbers (more flexible pattern)
                /GARAM\s*MASALA\s*[0-9][A-D]/i.test(text) ||
                // Specific check for GARAM MASALA 1B which might be problematic
                text.includes("MASALA 1B") ||
                // Match HEINÄPÄÄN TEKONURMI with more flexibility
                text.includes("HEINÄPÄÄN TEKONURMI") ||
                // Match HEPA - HALLI with more flexibility
                text.includes("HEPA - HALLI") ||
                // Match abbreviated forms
                text.includes("GARAM 2A") ||
                text.includes("GARAM 2B") ||
                text.includes("GARAM 2C") ||
                text.includes("GARAM 2D") ||
                text.includes("NURMI 4A") ||
                text.includes("NURMI 4B") ||
                text.includes("NURMI 4C") ||
                text.includes("NURMI 4D"));
            // Special debug logging for field detection
            if (text.includes("1B") || text.includes("MASALA")) {
                debugLog(`Potential field name candidate: "${text}" at x:${el.x.toFixed(2)}`);
                // Extra debug for GARAM MASALA 1B
                if (text.includes("GARAM MASALA 1B")) {
                    debugLog(`EXACT MATCH for GARAM MASALA 1B found!`);
                }
                if (text.includes("MASALA 1B")) {
                    debugLog(`Partial match for MASALA 1B found!`);
                }
                if (/GARAM\s*MASALA\s*1B/i.test(text)) {
                    debugLog(`Regex match for GARAM MASALA 1B found!`);
                }
            }
            if (isFieldName) {
                debugLog(`Field name detected: "${text}" at position ${idx}`);
            }
            return { element: el, isField: isFieldName, index: idx };
        });
        // Filter to only field elements
        const fieldNameElements = potentialFieldElements
            .filter(item => item.isField)
            .map(item => item.element);
        debugLog(`Found ${fieldNameElements.length} field name elements in this line`);
        if (fieldNameElements.length > 0) {
            debugLog(`Field names:`, fieldNameElements.map(el => el.text));
        }
        // Special handling for adjacent fields (like GARAM MASALA 1A and 1B)
        // This helps ensure we detect both fields even if they're on the same line
        if (fieldNameElements.length === 1) {
            const fieldEl = fieldNameElements[0];
            const fieldText = fieldEl.text.trim();
            // Check if this is a field that typically has an adjacent pair (like 1A should have 1B)
            if (fieldText.match(/[0-9][A|C]$/)) {
                // This is an 'A' or 'C' field, look for the corresponding 'B' or 'D' field
                const pairLetter = fieldText.endsWith('A') ? 'B' : 'D';
                const baseFieldName = fieldText.slice(0, -1); // Remove the last character (A or C)
                const expectedPairName = baseFieldName + pairLetter;
                debugLog(`Detected ${fieldText}, looking for adjacent field ${expectedPairName}`);
                // Look for elements that might be at a similar y-position but different x-position
                // This is more aggressive than the previous approach to catch fields that might be missed
                const potentialPairElements = line.filter(el => {
                    // Different element than the current field
                    if (el === fieldEl)
                        return false;
                    // Should be positioned to the right of the current field
                    if (el.x <= fieldEl.x)
                        return false;
                    // The text might contain the expected pair name or parts of it
                    const text = el.text.trim();
                    return (text.includes(expectedPairName) ||
                        text.includes(pairLetter) ||
                        (baseFieldName.includes("MASALA") && text.includes("MASALA") && text.includes(pairLetter)));
                });
                if (potentialPairElements.length > 0) {
                    debugLog(`Found potential adjacent field elements:`, potentialPairElements.map(el => el.text));
                    // Add these potential pair elements to our field elements list
                    fieldNameElements.push(...potentialPairElements);
                }
            }
        }
        if (fieldNameElements.length > 0) {
            currentLeftBlock = null; // Reset blocks
            currentRightBlock = null;
            let leftFieldEl = undefined;
            let rightFieldEl = undefined;
            // Enhanced field detection logic
            if (fieldNameElements.length === 1) {
                const fieldEl = fieldNameElements[0];
                leftFieldEl = fieldEl;
                debugLog(`Single field name found on line: "${fieldEl.text}", assigned as left field.`);
                // Enhanced detection for adjacent fields using field detection tolerance
                // Look for text elements that might be field names but weren't detected as such
                const potentialRightFields = line.filter(el => {
                    // Ensure leftFieldEl is defined before using it
                    if (!leftFieldEl)
                        return false;
                    return (
                    // Must be positioned to the right of the left field with some tolerance
                    el.x > leftFieldEl.x + leftFieldEl.w + fieldDetectionTolerance &&
                        // Must be within a reasonable vertical position
                        Math.abs(el.y - leftFieldEl.y) < 0.5 &&
                        // Must not be the same as the left field
                        el !== leftFieldEl &&
                        // Should have reasonable text length for a field name
                        el.text.length > 3);
                }).sort((a, b) => a.x - b.x);
                if (potentialRightFields.length > 0) {
                    // Found a potential right field that wasn't detected by our regular pattern
                    rightFieldEl = potentialRightFields[0];
                    debugLog(`Detected potential right field: "${rightFieldEl.text}" at x:${rightFieldEl.x.toFixed(2)}`);
                }
                // More generalized adjacent field detection
                // If we find a field with a pattern like "NAME 1A", look for "NAME 1B" in the same line
                const fieldNameMatch = fieldEl.text.match(/(.+)\s+(\d+[A-D])/);
                if (fieldNameMatch && !rightFieldEl) {
                    const baseName = fieldNameMatch[1]; // e.g., "GARAM MASALA"
                    const fieldNumber = fieldNameMatch[2]; // e.g., "1A"
                    // If this is an "A" field, look for the corresponding "B" field
                    if (fieldNumber.endsWith('A')) {
                        const bFieldNumber = fieldNumber.replace(/A$/, 'B');
                        const bFieldName = `${baseName} ${bFieldNumber}`;
                        debugLog(`Detected ${fieldEl.text}, looking for corresponding ${bFieldName}`);
                        // Check if this B field already exists in the current line
                        const existingBField = line.find(el => el.text.includes(bFieldName));
                        if (existingBField) {
                            debugLog(`Found existing B field: ${existingBField.text}`);
                            rightFieldEl = existingBField;
                        }
                        else {
                            // Look for any text element that might contain the B field name
                            // More aggressive matching for GARAM MASALA 1B which is problematic
                            const potentialBFields = line.filter(el => {
                                if (el === fieldEl)
                                    return false;
                                if (el.x <= fieldEl.x)
                                    return false; // Must be to the right
                                const text = el.text.trim();
                                return (text.includes(bFieldName) ||
                                    text.includes(bFieldNumber) ||
                                    (baseName === "GARAM MASALA" && text.includes("MASALA") && text.includes("1B")));
                            });
                            if (potentialBFields.length > 0) {
                                // Sort by x position and take the leftmost one
                                const sortedPotentialFields = potentialBFields.sort((a, b) => a.x - b.x);
                                rightFieldEl = sortedPotentialFields[0];
                                debugLog(`Found potential B field: ${rightFieldEl.text}`);
                            }
                            else {
                                // Special case for GARAM MASALA 1B - if we found GARAM MASALA 1A but not 1B
                                // Create a synthetic 1B field based on the 1A field's position
                                if (baseName === "GARAM MASALA" && fieldNumber === "1A") {
                                    debugLog(`Special case: Creating synthetic GARAM MASALA 1B field`);
                                    // Create a synthetic field element positioned to the right of 1A
                                    // This is based on the observation that 1B is typically positioned at x ~36
                                    // when 1A is at x ~3.4
                                    rightFieldEl = {
                                        text: "GARAM MASALA 1B",
                                        x: fieldEl.x + 32.5, // Approximate position based on PDF structure
                                        y: fieldEl.y,
                                        w: fieldEl.w
                                    };
                                }
                            }
                        }
                    }
                }
            }
            else if (fieldNameElements.length >= 2) {
                // Multiple field names found - sort by x position
                const sortedFields = [...fieldNameElements].sort((a, b) => a.x - b.x);
                leftFieldEl = sortedFields[0];
                rightFieldEl = sortedFields[1];
                debugLog(`Multiple field names found on line: Left="${leftFieldEl?.text}", Right="${rightFieldEl?.text}"`);
            }
            lineIndex++; // Move to header line
            if (lineIndex < lines.length) {
                const headerLine = lines[lineIndex];
                const leftHeaderElements = headerLine.filter(el => el.x < midPointX).sort((a, b) => a.x - b.x);
                let rightHeaderElements = [];
                if (rightFieldEl) {
                    rightHeaderElements = headerLine.filter(el => el.x >= rightFieldEl.x)
                        .sort((a, b) => a.x - b.x);
                }
                else {
                    rightHeaderElements = headerLine.filter(el => el.x >= midPointX).sort((a, b) => a.x - b.x);
                }
                if (leftFieldEl && leftHeaderElements.length >= 3) {
                    currentLeftBlock = {
                        name: leftFieldEl.text,
                        gameDuration: leftHeaderElements[0]?.text || "",
                        gameType: leftHeaderElements[1]?.text || "",
                        year: leftHeaderElements[2]?.text || "",
                        startX: leftFieldEl.x
                    };
                    console.log(`
--- Identified New LEFT Field Block: ${currentLeftBlock.name} (startX: ${currentLeftBlock.startX.toFixed(2)}) ---`);
                    console.log(`Header L: ${currentLeftBlock.gameDuration}, ${currentLeftBlock.gameType}, ${currentLeftBlock.year}`);
                }
                // Comment out detailed right header debugging
                /*
                if (rightFieldEl) {
                    console.log(`[DEBUG] For Right Field Candidate: "${rightFieldEl.text}" (x:${rightFieldEl.x.toFixed(2)})`);
                    console.log(`[DEBUG] Raw Right Header Elements (count: ${rightHeaderElements.length}):`);
                    rightHeaderElements.forEach((el, idx) => {
                        console.log(`[DEBUG]   RH[${idx}]: "${el.text}" (x:${el.x.toFixed(2)})`);
                    });
                } else {
                    console.log(`[DEBUG] No Right Field Candidate found for this field name line.`);
                }
                */
                if (rightFieldEl && rightHeaderElements.length >= 3) {
                    currentRightBlock = {
                        name: rightFieldEl.text,
                        gameDuration: rightHeaderElements[0]?.text || "",
                        gameType: rightHeaderElements[1]?.text || "",
                        year: rightHeaderElements[2]?.text || "",
                        startX: rightFieldEl.x
                    };
                    console.log(`
--- Identified New RIGHT Field Block: ${currentRightBlock.name} (startX: ${currentRightBlock.startX.toFixed(2)}) ---`);
                    console.log(`Header R: ${currentRightBlock.gameDuration}, ${currentRightBlock.gameType}, ${currentRightBlock.year}`);
                } /* else if (rightFieldEl) { // No longer needed as a warning if successful
                    console.log(`[WARN] Not enough right header elements found for "${rightFieldEl.text}" (found ${rightHeaderElements.length}, need 3).`);
                } */
            }
            lineIndex++;
            continue;
        }
        // Process left block games
        if (currentLeftBlock) {
            const blockStartX = currentLeftBlock.startX; // Capture for the filter's closure
            // More flexible filtering to capture elements in the left block
            const leftElements = line.filter(el => {
                // Adjust the filter to better capture elements in the left field block
                // Use a more flexible approach based on the x-coordinate relative to page width
                return el.x >= blockStartX && el.x < midPointX;
            }).sort((a, b) => a.x - b.x);
            // Store these for potential use in special case handling
            let leftTimeElement = null;
            let leftTeam1Element = null;
            let leftTeam2Element = null;
            // Check if we have a time element (first element should be a time format)
            if (leftElements.length > 0 && leftElements[0].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                leftTimeElement = leftElements[0];
                const time = leftTimeElement.text;
                let team1 = "";
                let team2 = "";
                // Extract team names, being careful to avoid treating times as team names
                if (leftElements.length > 1 && !leftElements[1].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                    leftTeam1Element = leftElements[1];
                    team1 = leftTeam1Element.text;
                }
                if (leftElements.length > 2 && !leftElements[2].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                    leftTeam2Element = leftElements[2];
                    team2 = leftTeam2Element.text;
                }
                // Create a game entry even if team names are empty (to capture time slots)
                if (time.trim()) {
                    // Try to infer year from team names, fallback to header year
                    const inferredYear = inferYearFromTeams(team1, team2);
                    const finalYear = inferredYear || currentLeftBlock.year;
                    // Use coordinate-based field assignment for more accuracy
                    let fieldName = currentLeftBlock.name;
                    // Check if this is a game for GARAM MASALA 1B that was incorrectly assigned to 1A
                    if (fieldName === "GARAM MASALA 1A" && currentRightBlock && currentRightBlock.name === "GARAM MASALA 1B") {
                        // Calculate the midpoint between the two field blocks
                        const midPointBetweenFields = (currentLeftBlock.startX + currentRightBlock.startX) / 2;
                        // If the time element is to the right of the midpoint, it belongs to the right field
                        if (leftTimeElement.x > midPointBetweenFields) {
                            fieldName = "GARAM MASALA 1B";
                            debugLog(`Reassigned game from GARAM MASALA 1A to 1B based on coordinate position: ${time}, x=${leftTimeElement.x}, midpoint=${midPointBetweenFields}`);
                        }
                        // If any team elements are positioned closer to the right field, assign to right field
                        if (leftTeam1Element && leftTeam1Element.x > midPointBetweenFields) {
                            fieldName = "GARAM MASALA 1B";
                            debugLog(`Reassigned game to GARAM MASALA 1B based on team1 position: ${time}, x=${leftTeam1Element.x}`);
                        }
                        if (leftTeam2Element && leftTeam2Element.x > midPointBetweenFields) {
                            fieldName = "GARAM MASALA 1B";
                            debugLog(`Reassigned game to GARAM MASALA 1B based on team2 position: ${time}, x=${leftTeam2Element.x}`);
                        }
                    }
                    games.push({
                        field: fieldName,
                        gameDuration: currentLeftBlock.gameDuration,
                        gameType: currentLeftBlock.gameType,
                        year: finalYear,
                        time,
                        team1,
                        team2
                    });
                    debugLog(`Game L in ${fieldName}: ${time} | ${team1 || '---'} vs ${team2 || '---'} | Year: ${finalYear}${inferredYear ? ' (inferred)' : ' (header)'}`);
                }
            }
            // Process right block games
            if (currentRightBlock) {
                const rightBlockStartX = currentRightBlock.startX;
                // More flexible filtering to capture elements in the right block
                const rightElements = line.filter(el => {
                    // Adjust the filter to better capture elements in the right field block
                    return el.x >= rightBlockStartX;
                }).sort((a, b) => a.x - b.x);
                // Store these for potential use in special case handling
                let rightTimeElement = null;
                let rightTeam1Element = null;
                let rightTeam2Element = null;
                // Check if we have a time element (first element should be a time format)
                if (rightElements.length > 0 && rightElements[0].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                    rightTimeElement = rightElements[0];
                    const time = rightTimeElement.text;
                    let team1 = "";
                    let team2 = "";
                    // Extract team names, being careful to avoid treating times as team names
                    if (rightElements.length > 1 && !rightElements[1].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                        rightTeam1Element = rightElements[1];
                        team1 = rightTeam1Element.text;
                    }
                    if (rightElements.length > 2 && !rightElements[2].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                        rightTeam2Element = rightElements[2];
                        team2 = rightTeam2Element.text;
                    }
                    // Create a game entry even if team names are empty (to capture time slots)
                    if (time.trim()) {
                        // Try to infer year from team names, fallback to header year
                        const inferredYear = inferYearFromTeams(team1, team2);
                        const finalYear = inferredYear || currentRightBlock.year;
                        // Use coordinate-based field assignment for more accuracy
                        let fieldName = currentRightBlock.name;
                        // If this is GARAM MASALA 1B, ensure we're correctly identifying it
                        if (fieldName === "GARAM MASALA 1B") {
                            // Add extra debugging for GARAM MASALA 1B games
                            debugLog(`Found GARAM MASALA 1B game: ${time} | ${team1 || 'No team'} vs ${team2 || 'No team'}`);
                            // Calculate the midpoint between the left and right field blocks
                            if (currentLeftBlock && currentLeftBlock.name === "GARAM MASALA 1A") {
                                const midPointBetweenFields = (currentLeftBlock.startX + currentRightBlock.startX) / 2;
                                // If the time element is closer to the left field, it might belong there
                                if (rightTimeElement.x < midPointBetweenFields) {
                                    debugLog(`Warning: This might be a GARAM MASALA 1A game based on position: ${time}, x=${rightTimeElement.x}, midpoint=${midPointBetweenFields}`);
                                }
                            }
                        }
                        games.push({
                            field: fieldName,
                            gameDuration: currentRightBlock.gameDuration,
                            gameType: currentRightBlock.gameType,
                            year: finalYear,
                            time,
                            team1,
                            team2
                        });
                        debugLog(`Game R in ${fieldName}: ${time} | ${team1 || '---'} vs ${team2 || '---'} | Year: ${finalYear}${inferredYear ? ' (inferred)' : ' (header)'}`);
                    }
                }
                // Special case for GARAM MASALA 1B
                // If we have a GARAM MASALA 1A game but no corresponding 1B game at the same time,
                // create a placeholder 1B game with the same time but empty teams
                if (currentLeftBlock.name === "GARAM MASALA 1A" &&
                    currentRightBlock.name === "GARAM MASALA 1B" &&
                    leftTimeElement) {
                    const time = leftTimeElement.text;
                    // Check if we already have a 1B game with this time
                    const existingGame = games.find(g => g.field === "GARAM MASALA 1B" && g.time === time);
                    if (!existingGame) {
                        // Look for team elements that might belong to GARAM MASALA 1B
                        // by checking their x-coordinates
                        const midPointBetweenFields = (currentLeftBlock.startX + currentRightBlock.startX) / 2;
                        // Find all elements in this line that are to the right of the midpoint
                        // and might be team names (not time elements)
                        const potentialRightTeamElements = line.filter(el => el.x > midPointBetweenFields &&
                            !el.text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)).sort((a, b) => a.x - b.x);
                        let rightTeam1 = "";
                        let rightTeam2 = "";
                        if (potentialRightTeamElements.length > 0) {
                            rightTeam1 = potentialRightTeamElements[0].text;
                            debugLog(`Found potential GARAM MASALA 1B team1: ${rightTeam1} at x=${potentialRightTeamElements[0].x}`);
                        }
                        if (potentialRightTeamElements.length > 1) {
                            rightTeam2 = potentialRightTeamElements[1].text;
                            debugLog(`Found potential GARAM MASALA 1B team2: ${rightTeam2} at x=${potentialRightTeamElements[1].x}`);
                        }
                        debugLog(`Creating GARAM MASALA 1B game for time ${time} with teams: ${rightTeam1 || 'No opponent'} vs ${rightTeam2 || 'No opponent'}`);
                        games.push({
                            field: "GARAM MASALA 1B",
                            gameDuration: currentRightBlock.gameDuration,
                            gameType: currentRightBlock.gameType,
                            year: currentRightBlock.year,
                            time,
                            team1: rightTeam1,
                            team2: rightTeam2
                        });
                    }
                }
            }
        }
        lineIndex++;
    }
    return games;
}
async function main() {
    const inputPath = path.join(PERSISTENT_STORAGE_BASE_PATH, 'parsed_pdf_data.json');
    const outputPath = path.join(PERSISTENT_STORAGE_BASE_PATH, 'extracted_games_output.json');
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
        // console.log(`--- Grouped Text Lines from Page ${i + 1} ---`);
        // lines.forEach((line, index) => {
        //   const lineText = line.map(el => `"${el.text}" (x:${el.x.toFixed(2)})`).join(' | ');
        //   const lineY = line.length > 0 ? line[0].y.toFixed(3) : 'N/A';
        //   console.log(`Line ${index + 1} (y~${lineY}, items: ${line.length}): ${lineText}`);
        // });
        const gamesFromPage = processPageLines(lines, page.Width);
        allGames.push(...gamesFromPage);
    }
    console.log(`
Extraction finished. Found ${allGames.length} games in total.`);
    // For inspection, print the first few games if any
    if (allGames.length > 0 || documentDate) {
        console.log("\n--- Sample Extracted Games ---");
        allGames.slice(0, 5).forEach(game => console.log(game));
        const outputData = {
            documentDate,
            games: allGames,
            sourceFile: parsedData.sourcePdfFile ? path.basename(parsedData.sourcePdfFile) : undefined // Extract and store just the filename
        };
        // Ensure the output directory exists before writing the final JSON
        const outputDir = path.dirname(outputPath);
        try {
            fs.mkdirSync(outputDir, { recursive: true }); // Use mkdirSync for simplicity here or convert main to async for await fs.promises.mkdir
            console.log(`Directory ensured for final output: ${outputDir}`);
        }
        catch (error) {
            console.error(`Error creating directory ${outputDir} for final output:`, error);
            // Decide if to throw or proceed if directory already exists (recursive:true handles this for mkdirSync)
        }
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
        console.log(`\nAll extracted data (including date and games) saved to ${outputPath}`);
    }
    else {
        console.log('No games extracted and no date found, so extracted_games_output.json was not written.');
    }
}
main().catch(console.error);
