// admin_app/src/pageParserUtils.ts
// ----- Utility Functions (moved or new) -----
/**
 * Infer year from team names.
 * @param team1 First team name.
 * @param team2 Second team name.
 * @returns Inferred year string or null.
 */
export function inferYearFromTeams(team1, team2) {
    const teams = [team1, team2].filter(t => t && t.trim()); // Ensure t is not null before calling trim
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
// Further helper functions (detectFieldNamesOnLine, initializeFieldBlocks, etc.) will be added here.
export function detectFieldNamesOnLine(line, pageWidth, // Used for isLandscape calculation, though not directly in this snippet
fieldDetectionTolerance, debugLog) {
    let leftFieldEl = undefined;
    let rightFieldEl = undefined;
    // Enhanced field name detection with more flexible matching
    debugLog(`Analyzing line for field names with ${line.length} elements`);
    line.forEach((el, idx) => {
        const text = el.text.trim();
        debugLog(`Line element ${idx}: "${text}" at x:${el.x.toFixed(2)}, y:${el.y.toFixed(2)}, w:${el.w.toFixed(2)}`);
    });
    const potentialFieldElements = line.map((el, idx) => {
        const text = el.text.trim();
        const normalizedText = text.toUpperCase(); // Normalize for easier matching
        // Regex for GARAM MASALA fields like GARAM MASALA 1A, GARAM MASALA 2D, etc.
        const isGaramMasalaType = /GARAM\s*MASALA\s*[0-9][A-D]/.test(normalizedText);
        if (normalizedText.includes("GARAM MASALA") && /[0-9][A-D]/.test(normalizedText.substr(normalizedText.indexOf("MASALA")))) {
            debugLog(`[DEBUG GARAM REGEX] Text: "${text}", Normalized: "${normalizedText}", isGaramMasalaType: ${isGaramMasalaType}`);
        }
        // Regex for HEPA - HALLI fields like HEPA - HALLI A, HEPA-HALLI D, etc.
        const isHepaHalliType = /HEPA\s*-\s*HALLI\s*[A-D]/.test(normalizedText);
        // Regex for HEINÄPÄÄN TEKONURMI, optionally followed by A, B, C, or D
        const isHeinapaaTekonurmiType = /HEINÄPÄÄN\s*TEKONURMI(\s*[A-D])?/.test(normalizedText);
        // Regex for NURMI fields, assuming a similar pattern to GARAM MASALA
        const isNurmiType = /NURMI\s*[0-9][A-D]/.test(normalizedText);
        // Fallback for generic GARAM MASALA name if specific lettered/numbered version isn't matched
        const isGenericGaramMasala = !isGaramMasalaType && normalizedText.includes("GARAM MASALA");
        // Fallback for generic HEPA - HALLI name
        const isGenericHepaHalli = !isHepaHalliType && normalizedText.includes("HEPA") && normalizedText.includes("HALLI");
        // Fallback for generic HEINÄPÄÄN TEKONURMI name
        const isGenericHeinapaa = !isHeinapaaTekonurmiType && normalizedText.includes("HEINÄPÄÄN TEKONURMI");
        const isFieldName = (isGaramMasalaType ||
            isHepaHalliType ||
            isHeinapaaTekonurmiType ||
            isNurmiType ||
            isGenericGaramMasala ||
            isGenericHepaHalli ||
            isGenericHeinapaa);
        if (normalizedText.includes("1B") || normalizedText.includes("MASALA")) {
            debugLog(`Potential field name candidate: "${text}" at x:${el.x.toFixed(2)}`);
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
    const fieldNameElements = potentialFieldElements
        .filter(item => item.isField)
        .map(item => item.element);
    debugLog(`Found ${fieldNameElements.length} field name elements in this line`);
    if (fieldNameElements.length > 0) {
        debugLog(`Field names:`, fieldNameElements.map(el => el.text));
    }
    if (fieldNameElements.length === 1) {
        const fieldEl = fieldNameElements[0];
        leftFieldEl = fieldEl;
        debugLog(`Single field name found on line: "${fieldEl.text}", assigned as left field.`);
        const potentialRightFields = line.filter(el => {
            if (!leftFieldEl)
                return false;
            return (el.x > leftFieldEl.x + leftFieldEl.w + fieldDetectionTolerance &&
                Math.abs(el.y - leftFieldEl.y) < 0.5 &&
                el !== leftFieldEl &&
                el.text.length > 3);
        }).sort((a, b) => a.x - b.x);
        if (potentialRightFields.length > 0) {
            rightFieldEl = potentialRightFields[0];
            debugLog(`Detected potential right field: "${rightFieldEl.text}" at x:${rightFieldEl.x.toFixed(2)}`);
        }
        const fieldNameMatch = fieldEl.text.match(/(.+)\s+(\d+[A-D])/);
        if (fieldNameMatch && !rightFieldEl) {
            const baseName = fieldNameMatch[1];
            const fieldNumber = fieldNameMatch[2];
            if (fieldNumber.endsWith('A')) {
                const bFieldNumber = fieldNumber.replace(/A$/, 'B');
                const bFieldName = `${baseName} ${bFieldNumber}`;
                debugLog(`Detected ${fieldEl.text}, looking for corresponding ${bFieldName}`);
                const existingBField = line.find(el => el.text.includes(bFieldName));
                if (existingBField) {
                    debugLog(`Found existing B field: ${existingBField.text}`);
                    rightFieldEl = existingBField;
                }
                else {
                    const potentialBFields = line.filter(el => {
                        if (el === fieldEl)
                            return false;
                        if (el.x <= fieldEl.x)
                            return false;
                        const text = el.text.trim();
                        return (text.includes(bFieldName) ||
                            text.includes(bFieldNumber) ||
                            (baseName === "GARAM MASALA" && text.includes("MASALA") && text.includes("1B")));
                    });
                    if (potentialBFields.length > 0) {
                        const sortedPotentialFields = potentialBFields.sort((a, b) => a.x - b.x);
                        rightFieldEl = sortedPotentialFields[0];
                        debugLog(`Found potential B field: ${rightFieldEl.text}`);
                    }
                    else {
                        if (baseName === "GARAM MASALA" && fieldNumber === "1A") {
                            debugLog(`Special case: Creating synthetic GARAM MASALA 1B field`);
                            rightFieldEl = {
                                text: "GARAM MASALA 1B",
                                x: fieldEl.x + 32.5,
                                y: fieldEl.y,
                                w: fieldEl.w
                            };
                        }
                    }
                }
            }
        }
        // Special handling for adjacent fields (like GARAM MASALA 1A and 1B)
        // This helps ensure we detect both fields even if they're on the same line
        // This was an attempt to fix a specific bug, might need refinement or integration with the above logic
        if (fieldNameElements.length === 1) { // This condition is redundant if we are already inside this block, but keeping for now
            const currentFieldEl = fieldNameElements[0]; // This is `leftFieldEl`
            const fieldText = currentFieldEl.text.trim();
            if (fieldText.match(/[0-9][A|C]$/)) {
                const pairLetter = fieldText.endsWith('A') ? 'B' : 'D';
                const baseFieldName = fieldText.slice(0, -1);
                const expectedPairName = baseFieldName + pairLetter;
                debugLog(`Detected ${fieldText}, looking for adjacent field ${expectedPairName} (additional check)`);
                if (expectedPairName.includes("GARAM MASALA 1D") || expectedPairName.includes("GARAM MASALA 2B")) {
                    debugLog(`[DEBUG ADJACENT PAIR SEARCH] Seeking: ${expectedPairName}`);
                }
                const potentialPairElements = line.filter(el => {
                    if (el === currentFieldEl)
                        return false;
                    if (el.x <= currentFieldEl.x)
                        return false;
                    const text = el.text.trim();
                    if (expectedPairName.includes("GARAM MASALA 1D") || expectedPairName.includes("GARAM MASALA 2B")) {
                        debugLog(`[DEBUG ADJACENT PAIR CHECKING] Expected: "${expectedPairName}", Checking element text: "${text}"`);
                    }
                    return (text.includes(expectedPairName) ||
                        text.includes(pairLetter) ||
                        (baseFieldName.includes("MASALA") && text.includes("MASALA") && text.includes(pairLetter)));
                });
                if (potentialPairElements.length > 0 && !rightFieldEl) { // Only if not already found
                    debugLog(`Found potential adjacent field elements (additional check):`, potentialPairElements.map(el => el.text));
                    // This logic might conflict/overlap with the bFieldName logic above.
                    // For now, let's assume the earlier logic for 'bFieldName' is more robust or prioritize it.
                    // If rightFieldEl is still undefined, we can use this.
                    rightFieldEl = potentialPairElements.sort((a, b) => a.x - b.x)[0];
                    debugLog(`Assigned right field via additional check: "${rightFieldEl.text}"`);
                }
            }
        }
    }
    else if (fieldNameElements.length >= 2) {
        const sortedFields = [...fieldNameElements].sort((a, b) => a.x - b.x);
        leftFieldEl = sortedFields[0];
        rightFieldEl = sortedFields[1];
        debugLog(`Multiple field names found on line: Left="${leftFieldEl?.text}", Right="${rightFieldEl?.text}"`);
    }
    return { leftFieldEl, rightFieldEl };
}
export function initializeFieldBlocks(detectedFields, headerLine, midPointX, debugLog) {
    let currentLeftBlock = null;
    let currentRightBlock = null;
    const { leftFieldEl, rightFieldEl } = detectedFields;
    const leftHeaderElements = headerLine.filter(el => el.x < midPointX).sort((a, b) => a.x - b.x);
    let rightHeaderElements = [];
    if (rightFieldEl) {
        // If a right field element exists, header elements for the right block should be to its right or aligned with it.
        rightHeaderElements = headerLine.filter(el => el.x >= (rightFieldEl.x - 0.2)).sort((a, b) => a.x - b.x); // Added tolerance
    }
    else {
        // If no specific right field element, use midpoint as a fallback (less precise)
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
        debugLog(`--- Identified New LEFT Field Block: ${currentLeftBlock.name} (startX: ${currentLeftBlock.startX.toFixed(2)}) ---`);
        debugLog(`Header L: ${currentLeftBlock.gameDuration}, ${currentLeftBlock.gameType}, ${currentLeftBlock.year}`);
    }
    else if (leftFieldEl) {
        debugLog(`[WARN] Not enough left header elements found for "${leftFieldEl.text}" (found ${leftHeaderElements.length}, need 3).`);
    }
    if (rightFieldEl && rightHeaderElements.length >= 3) {
        currentRightBlock = {
            name: rightFieldEl.text,
            gameDuration: rightHeaderElements[0]?.text || "",
            gameType: rightHeaderElements[1]?.text || "",
            year: rightHeaderElements[2]?.text || "",
            startX: rightFieldEl.x
        };
        debugLog(`--- Identified New RIGHT Field Block: ${currentRightBlock.name} (startX: ${currentRightBlock.startX.toFixed(2)}) ---`);
        debugLog(`Header R: ${currentRightBlock.gameDuration}, ${currentRightBlock.gameType}, ${currentRightBlock.year}`);
    }
    else if (rightFieldEl) {
        debugLog(`[WARN] Not enough right header elements found for "${rightFieldEl.text}" (found ${rightHeaderElements.length}, need 3).`);
    }
    return { currentLeftBlock, currentRightBlock };
}
export function extractGamesFromLineForBlock(lineElements, blockInfo, midPointX, // To determine element boundaries for a block
isLeftBlock, otherBlockInfo, // For GARAM MASALA 1A/1B reassignment logic
debugLog, pageWidth // For more context if needed, though primarily midPointX is used for boundaries
) {
    const gamesOutput = [];
    if (!blockInfo)
        return gamesOutput;
    const blockStartX = blockInfo.startX;
    let relevantElements;
    if (isLeftBlock) {
        // Elements are to the right of blockStartX and to the left of midPointX (or otherBlockInfo.startX if it's closer)
        const rightBoundary = otherBlockInfo ? Math.min(midPointX, otherBlockInfo.startX - 0.1) : midPointX;
        relevantElements = lineElements.filter(el => el.x >= blockStartX && el.x < rightBoundary)
            .sort((a, b) => a.x - b.x);
    }
    else { // Right block
        // Elements are to the right of blockStartX
        relevantElements = lineElements.filter(el => el.x >= (blockStartX - 0.2)) // Added tolerance
            .sort((a, b) => a.x - b.x);
    }
    if (relevantElements.length > 0 && relevantElements[0].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
        const timeElement = relevantElements[0];
        const time = timeElement.text;
        let team1 = "";
        let team2 = "";
        let team1Element = null;
        let team2Element = null;
        if (relevantElements.length > 1 && !relevantElements[1].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
            team1Element = relevantElements[1];
            team1 = team1Element.text;
        }
        if (relevantElements.length > 2 && !relevantElements[2].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
            team2Element = relevantElements[2];
            team2 = team2Element.text;
        }
        if (time.trim()) {
            const inferredYear = inferYearFromTeams(team1, team2);
            let finalYear = inferredYear || blockInfo.year;
            let fieldName = blockInfo.name;
            // GARAM MASALA 1A/1B reassignment logic
            if (isLeftBlock && blockInfo.name === "GARAM MASALA 1A" && otherBlockInfo && otherBlockInfo.name === "GARAM MASALA 1B") {
                const midPointBetweenFields = (blockInfo.startX + otherBlockInfo.startX) / 2;
                if (timeElement.x > midPointBetweenFields) {
                    fieldName = otherBlockInfo.name; // Reassign to 1B
                    finalYear = inferredYear || otherBlockInfo.year; // Use 1B's header year if no inference
                    debugLog(`Reassigned game from ${blockInfo.name} to ${fieldName} based on TIME coordinate: ${time}, x=${timeElement.x.toFixed(2)}, mid=${midPointBetweenFields.toFixed(2)}`);
                }
                else if (team1Element && team1Element.x > midPointBetweenFields) {
                    fieldName = otherBlockInfo.name;
                    finalYear = inferredYear || otherBlockInfo.year;
                    debugLog(`Reassigned game from ${blockInfo.name} to ${fieldName} based on TEAM1 coordinate: ${time}, x=${team1Element.x.toFixed(2)}, mid=${midPointBetweenFields.toFixed(2)}`);
                }
                else if (team2Element && team2Element.x > midPointBetweenFields) {
                    fieldName = otherBlockInfo.name;
                    finalYear = inferredYear || otherBlockInfo.year;
                    debugLog(`Reassigned game from ${blockInfo.name} to ${fieldName} based on TEAM2 coordinate: ${time}, x=${team2Element.x.toFixed(2)}, mid=${midPointBetweenFields.toFixed(2)}`);
                }
            }
            gamesOutput.push({
                field: fieldName,
                gameDuration: blockInfo.gameDuration, // This should be from the correct block after reassignment
                gameType: blockInfo.gameType, // This should be from the correct block after reassignment
                year: finalYear,
                time,
                team1,
                team2
            });
            const blockLabel = isLeftBlock ? "L" : "R";
            debugLog(`Game ${blockLabel} in ${fieldName}: ${time} | ${team1 || '---'} vs ${team2 || '---'} | Year: ${finalYear}${inferredYear ? ' (inferred)' : ' (header)'}`);
        }
    }
    return gamesOutput;
}
