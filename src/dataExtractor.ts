import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// ----- Interfaces for our extracted data -----
interface ExtractedTextElement {
  text: string;
  x: number;
  y: number;
  w: number; 
}

interface GameInfo {
  field: string;
  gameDuration: string;
  gameType: string;
  year: string;
  time: string;
  team1: string;
  team2: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// New function to process lines from a page
function processPageLines(lines: ExtractedTextElement[][], pageWidth: number): GameInfo[] {
  const games: GameInfo[] = [];
  let currentLeftBlock: { name: string; gameDuration: string; gameType: string; year: string; startX: number; } | null = null;
  let currentRightBlock: { name: string; gameDuration: string; gameType: string; year: string; startX: number; } | null = null;

  const midPointX = pageWidth / 2.0; 

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (line.length === 0) {
      lineIndex++;
      continue;
    }

    const fieldNameElements = line.filter(el => 
        el.text.includes("GARAM MASALA") || 
        el.text.includes("HEINÄPÄÄN TEKONURMI") || 
        el.text.includes("HEPA - HALLI")
    );

    if (fieldNameElements.length > 0) {
        currentLeftBlock = null; // Reset blocks
        currentRightBlock = null;

        let leftFieldEl: ExtractedTextElement | undefined = undefined;
        let rightFieldEl: ExtractedTextElement | undefined = undefined;

        if (fieldNameElements.length === 1) {
            const fieldEl = fieldNameElements[0];
            leftFieldEl = fieldEl;
            // console.log(`[DEBUG] Single field name found on line: "${fieldEl.text}", assigned as left field.`);
        } else if (fieldNameElements.length >= 2) {
            const sortedFields = [...fieldNameElements].sort((a, b) => a.x - b.x);
            leftFieldEl = sortedFields[0];
            rightFieldEl = sortedFields[1]; 
            // console.log(`[DEBUG] Multiple field names found on line: Left="${leftFieldEl?.text}", Right="${rightFieldEl?.text}"`);
        }

        lineIndex++; // Move to header line
        if (lineIndex < lines.length) {
            const headerLine = lines[lineIndex];
            const leftHeaderElements = headerLine.filter(el => el.x < midPointX).sort((a,b) => a.x - b.x);
            let rightHeaderElements: ExtractedTextElement[] = [];

            if (rightFieldEl) {
                rightHeaderElements = headerLine.filter(el => el.x >= rightFieldEl.x) 
                                              .sort((a,b) => a.x - b.x);
            } else {
                rightHeaderElements = headerLine.filter(el => el.x >= midPointX).sort((a,b) => a.x - b.x);
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

    if (currentLeftBlock) {
        const blockStartX = currentLeftBlock.startX; // Capture for the filter's closure
        const leftElements = line.filter(el => el.x >= blockStartX && el.x < midPointX).sort((a,b) => a.x - b.x);
        if (leftElements.length > 0 && leftElements[0].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
            const time = leftElements[0].text;
            let team1 = "";
            let team2 = "";
            if (leftElements.length > 1 && !leftElements[1].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) team1 = leftElements[1].text;
            if (leftElements.length > 2 && !leftElements[2].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) team2 = leftElements[2].text;
            
            if (time.trim() || team1.trim() || team2.trim()) {
                 games.push({
                    field: currentLeftBlock.name,
                    gameDuration: currentLeftBlock.gameDuration,
                    gameType: currentLeftBlock.gameType,
                    year: currentLeftBlock.year,
                    time: time,
                    team1: team1,
                    team2: team2,
                });
                console.log(`Game L in ${currentLeftBlock.name}: ${time} | ${team1 || '---'} vs ${team2 || '---'}`);
            }
        }
    }

    if (currentRightBlock) {
        const blockStartX = currentRightBlock.startX; // Capture for the filter's closure
        const rightElements = line.filter(el => el.x >= blockStartX).sort((a,b) => a.x - b.x);
        if (rightElements.length > 0 && rightElements[0].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
            const time = rightElements[0].text;
            let team1 = "";
            let team2 = "";
            if (rightElements.length > 1 && !rightElements[1].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) team1 = rightElements[1].text;
            if (rightElements.length > 2 && !rightElements[2].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) team2 = rightElements[2].text;

            if (time.trim() || team1.trim() || team2.trim()) {
                games.push({
                    field: currentRightBlock.name,
                    gameDuration: currentRightBlock.gameDuration,
                    gameType: currentRightBlock.gameType,
                    year: currentRightBlock.year,
                    time: time,
                    team1: team1,
                    team2: team2,
                });
                console.log(`Game R in ${currentRightBlock.name}: ${time} | ${team1 || '---'} vs ${team2 || '---'}`);
            }
        }
    }
    lineIndex++;
  }
  return games;
}

async function main() {
  const jsonFilePath = path.join(__dirname, '..', 'parsed_pdf_data.json');
  console.log(`Reading PDF data from: ${jsonFilePath}`);

  try {
    const fileContent = fs.readFileSync(jsonFilePath, 'utf-8');
    const pdfData = JSON.parse(fileContent) as PdfJsonOutput;

    console.log(`Successfully parsed PDF data. Number of pages: ${pdfData.Pages.length}`);
    if (pdfData.Pages.length === 0) {
      console.log('No pages found in PDF data.');
      return;
    }

    const allGames: GameInfo[] = [];

    for (let i = 0; i < pdfData.Pages.length; i++) {
      const page = pdfData.Pages[i];
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
    if (allGames.length > 0) {
      console.log("\n--- Sample Extracted Games ---");
      allGames.slice(0, 5).forEach(game => console.log(game));
       // Save all games to a file for easier inspection
      fs.writeFileSync('extracted_games_output.json', JSON.stringify(allGames, null, 2));
      console.log('\nAll extracted games saved to extracted_games_output.json');
    } else {
      console.log('No games extracted, so extracted_games_output.json was not written.');
    }
    

  } catch (error) {
    console.error('Error processing PDF data:', error);
  }
}

main().catch(console.error); 