import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Debug utility function
function debugLog(message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[EXTRACTOR ${timestamp}] ${message}`;
  
  console.log(logMessage);
  if (data !== undefined) {
    if (typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data);
    }
  }
}

// ----- Interfaces for PDF JSON structure (simplified) -----
interface PdfJsonTextRun {
  T: string; // The text, URL encoded
}

interface PdfJsonTextElement {
  x: number;
  y: number;
  w: number; 
  R: PdfJsonTextRun[]; 
}

interface PdfJsonPage {
  Width: number;
  Height: number;
  Texts: PdfJsonTextElement[];
}

interface PdfJsonOutput {
  Meta: object; 
  Pages: PdfJsonPage[];
}

// New interface for the final output structure
interface ExtractedOutput {
  documentDate: string | null;
  games: GameInfo[];
  sourceFile?: string; // Added to store the name of the PDF it came from
}

import type { ExtractedTextElement, GameInfo, FieldBlockInfo, DebugLogUtil } from './pageParserUtils.js'; // Ensured all necessary types are imported and removed original local definitions below.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';

function decodeText(encodedText: string): string {
  try {
    return decodeURIComponent(encodedText);
  } catch (e) {
    return encodedText; 
  }
}

function groupElementsByLine(
  elements: ExtractedTextElement[],
  yTolerance: number = 0.15 
): ExtractedTextElement[][] {
  if (!elements.length) {
    return [];
  }
  const sortedElements = [...elements].sort((a, b) => {
    if (a.y < b.y) return -1;
    if (a.y > b.y) return 1;
    if (a.x < b.x) return -1;
    if (a.x > b.x) return 1;
    return 0;
  });
  const lines: ExtractedTextElement[][] = [];
  let currentLine: ExtractedTextElement[] = [sortedElements[0]];
  for (let i = 1; i < sortedElements.length; i++) {
    const currentElement = sortedElements[i];
    if (Math.abs(currentElement.y - currentLine[0].y) < yTolerance) {
      currentLine.push(currentElement);
    } else {
      lines.push([...currentLine].sort((a,b) => a.x - b.x)); 
      currentLine = [currentElement];
    }
  }
  if (currentLine.length > 0) {
    lines.push([...currentLine].sort((a,b) => a.x - b.x));
  }
  return lines;
}

function extractTextElementsFromPage(page: PdfJsonPage): ExtractedTextElement[] {
  const elements: ExtractedTextElement[] = [];
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
    if (a.y < b.y) return -1;
    if (a.y > b.y) return 1;
    if (a.x < b.x) return -1;
    if (a.x > b.x) return 1;
    return 0;
  });
  return elements;
}

// inferYearFromTeams moved to pageParserUtils.ts
import { inferYearFromTeams, detectFieldNamesOnLine, initializeFieldBlocks, extractGamesFromLineForBlock } from './pageParserUtils.js'; // Added extractGamesFromLineForBlock

// New function to process lines from a page
function processPageLines(lines: ExtractedTextElement[][], pageWidth: number): GameInfo[] {
  const games: GameInfo[] = [];
  let currentLeftBlock: FieldBlockInfo | null = null;
  let currentRightBlock: FieldBlockInfo | null = null;

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
        const { currentLeftBlock: newLeftBlock, currentRightBlock: newRightBlock } = initializeFieldBlocks(
          { leftFieldEl, rightFieldEl },
          headerDataLineElements,
          midPointX,
          debugLog
        );
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
      if (currentRightBlock && leftBlockGames.some((g: GameInfo) => g.field === currentRightBlock!.name)) {
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
  const outputPath = path.join(PERSISTENT_STORAGE_BASE_PATH, 'extracted_games_output.json');

  console.log(`Reading PDF data from: ${inputPath}`);
  let rawPdfJson: string;
  try {
    rawPdfJson = fs.readFileSync(inputPath, 'utf-8');
  } catch (error) {
    console.error(`Failed to read input JSON file: ${inputPath}`, error);
    return;
  }

  let parsedData: PdfJsonOutput & { sourcePdfFile?: string }; // Add sourcePdfFile to type
  try {
    parsedData = JSON.parse(rawPdfJson);
  } catch (error) {
    console.error(`Failed to parse input JSON from ${inputPath}`, error);
    return;
  }

  if (!parsedData || !parsedData.Pages || parsedData.Pages.length === 0) {
      console.log('No pages found in PDF data.');
      return;
    }

    let documentDate: string | null = null;
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

    const allGames: GameInfo[] = [];

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
      
      const outputData: ExtractedOutput = {
        documentDate,
      games: allGames,
      sourceFile: parsedData.sourcePdfFile ? path.basename(parsedData.sourcePdfFile) : undefined // Extract and store just the filename
    };

    // Ensure the output directory exists before writing the final JSON
    const outputDir = path.dirname(outputPath);
    try {
        fs.mkdirSync(outputDir, { recursive: true }); // Use mkdirSync for simplicity here or convert main to async for await fs.promises.mkdir
        console.log(`Directory ensured for final output: ${outputDir}`);
    } catch (error) {
        console.error(`Error creating directory ${outputDir} for final output:`, error);
        // Decide if to throw or proceed if directory already exists (recursive:true handles this for mkdirSync)
    }

    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    console.log(`\nAll extracted data (including date and games) saved to ${outputPath}`);
    } else {
      console.log('No games extracted and no date found, so extracted_games_output.json was not written.');
    }
    

}

main().catch(console.error); 