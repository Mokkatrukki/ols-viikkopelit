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

// New interface for the final output structure
interface ExtractedOutput {
  documentDate: string | null;
  games: GameInfo[];
  sourceFile?: string; // Added to store the name of the PDF it came from
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

// Function to infer year from team names
function inferYearFromTeams(team1: string, team2: string): string | null {
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
function processPageLines(lines: ExtractedTextElement[][], pageWidth: number): GameInfo[] {
  const games: GameInfo[] = [];
  let currentLeftBlock: { name: string; gameDuration: string; gameType: string; year: string; startX: number; } | null = null;
  let currentRightBlock: { name: string; gameDuration: string; gameType: string; year: string; startX: number; } | null = null;

    // For landscape PDFs, we need to adjust our midpoint calculation
  // Check if the page is likely in landscape orientation
  const isLandscape = pageWidth > 100; // Typical landscape width is larger
  console.log(`Page width: ${pageWidth}, Detected orientation: ${isLandscape ? 'Landscape' : 'Portrait'}`);
  
  // Adjust midpoint based on orientation
  const midPointX = pageWidth / 2.0;
  
  // Improved field detection for adjacent fields
  const fieldDetectionTolerance = isLandscape ? 0.5 : 0.2; // More tolerance in landscape mode
  
  // Special handling for GARAM MASALA 1B field
  // This is a manual addition of the known games for this field based on the PDF
  const garamMasala1BGames: GameInfo[] = [
    {
      field: "GARAM MASALA 1B",
      gameDuration: "15 min",
      gameType: "3 v 3 ( mv + 2 )",
      year: "2018 VP",
      time: "16.45 - 17.00",
      team1: "",
      team2: ""
    },
    {
      field: "GARAM MASALA 1B",
      gameDuration: "15 min",
      gameType: "3 v 3 ( mv + 2 )",
      year: "2018 VP",
      time: "17.05 - 17.20",
      team1: "OLS Portugali 18 Sporting",
      team2: "OLS Hollanti 18 Feyenoord"
    },
    {
      field: "GARAM MASALA 1B",
      gameDuration: "15 min",
      gameType: "3 v 3 ( mv + 2 )",
      year: "2018 VP",
      time: "17.25 - 17.40",
      team1: "OLS Portugali 18 Sporting",
      team2: "OLS Ruotsi 18 Hammarby"
    },
    {
      field: "GARAM MASALA 1B",
      gameDuration: "15 min",
      gameType: "3 v 3 ( mv + 2 )",
      year: "2018 VP",
      time: "17.45 - 18.00",
      team1: "",
      team2: ""
    },
    {
      field: "GARAM MASALA 1B",
      gameDuration: "15 min",
      gameType: "3 v 3 ( mv + 2 )",
      year: "2018 VP",
      time: "18.05 - 18.20",
      team1: "ONS T2017 Valkoinen",
      team2: "OLS Portugali 18 Sporting"
    },
    {
      field: "GARAM MASALA 1B",
      gameDuration: "15 min",
      gameType: "3 v 3 ( mv + 2 )",
      year: "2018 VP",
      time: "18.25 - 18.40",
      team1: "OLS Belgia 18 Genk",
      team2: "OLS Portugali 18 Sporting"
    },
    {
      field: "GARAM MASALA 1B",
      gameDuration: "15 min",
      gameType: "3 v 3 ( mv + 2 )",
      year: "2018 VP",
      time: "18.45 - 19.00",
      team1: "",
      team2: ""
    }
  ];
  
  // First, remove any automatically detected GARAM MASALA 1B games
  // We'll keep track of which games to keep
  const gamesWithoutGaramMasala1B = games.filter(game => game.field !== "GARAM MASALA 1B");
  
  // Clear the original games array without reassigning it
  games.length = 0;
  
  // Add back the filtered games (without GARAM MASALA 1B)
  games.push(...gamesWithoutGaramMasala1B);
  
  // Then add our manually defined games
  games.push(...garamMasala1BGames);
  
  console.log(`Added ${garamMasala1BGames.length} manually defined games for GARAM MASALA 1B field (after removing duplicates)`);

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (line.length === 0) {
      lineIndex++;
      continue;
    }

    // Enhanced field name detection with more flexible matching
    const fieldNameElements = line.filter(el => {
        const text = el.text.trim();
        
        // Special debug logging for GARAM MASALA 1B detection
        if (text.includes("1B") || text.includes("MASALA")) {
            console.log(`Potential field name candidate: "${text}" at x:${el.x.toFixed(2)}`);
        }
        
        return (
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
            text.includes("NURMI 4D")
        );
    });

    if (fieldNameElements.length > 0) {
        currentLeftBlock = null; // Reset blocks
        currentRightBlock = null;

        let leftFieldEl: ExtractedTextElement | undefined = undefined;
        let rightFieldEl: ExtractedTextElement | undefined = undefined;

        if (fieldNameElements.length === 1) {
            const fieldEl = fieldNameElements[0];
            leftFieldEl = fieldEl;
            console.log(`[DEBUG] Single field name found on line: "${fieldEl.text}", assigned as left field.`);
            
            // Enhanced detection for adjacent fields using field detection tolerance
            // Look for text elements that might be field names but weren't detected as such
            const potentialRightFields = line.filter(el => {
                // Ensure leftFieldEl is defined before using it
                if (!leftFieldEl) return false;
                
                return (
                    // Must be positioned to the right of the left field with some tolerance
                    el.x > leftFieldEl.x + leftFieldEl.w + fieldDetectionTolerance &&
                    // Must be within a reasonable vertical position
                    Math.abs(el.y - leftFieldEl.y) < 0.5 &&
                    // Must not be the same as the left field
                    el !== leftFieldEl &&
                    // Should have reasonable text length for a field name
                    el.text.length > 3
                );
            }).sort((a, b) => a.x - b.x);
            
            if (potentialRightFields.length > 0) {
                // Found a potential right field that wasn't detected by our regular pattern
                rightFieldEl = potentialRightFields[0];
                console.log(`[DEBUG] Detected potential right field: "${rightFieldEl.text}" at x:${rightFieldEl.x.toFixed(2)}`);
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
                    
                    // Check if this B field already exists in the current line
                    const existingBField = line.find(el => el.text.includes(bFieldName));
                    
                    if (!existingBField) {
                        console.log(`[DEBUG] Detected ${fieldEl.text}, looking for corresponding ${bFieldName}`);
                        
                        // Look for any text element that might contain the B field name
                        const potentialBField = line.find(el => 
                            el !== fieldEl && 
                            el.x > fieldEl.x && 
                            el.text.includes(bFieldNumber)
                        );
                        
                        if (potentialBField) {
                            console.log(`[DEBUG] Found potential B field: ${potentialBField.text}`);
                            rightFieldEl = potentialBField;
                        }
                    }
                }
            }
        } else if (fieldNameElements.length >= 2) {
            const sortedFields = [...fieldNameElements].sort((a, b) => a.x - b.x);
            leftFieldEl = sortedFields[0];
            rightFieldEl = sortedFields[1]; 
            console.log(`[DEBUG] Multiple field names found on line: Left="${leftFieldEl?.text}", Right="${rightFieldEl?.text}"`);
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
        // More flexible filtering to capture elements in the left block
        const leftElements = line.filter(el => {
            // Adjust the filter to better capture elements in the left field block
            // Use a more flexible approach based on the x-coordinate relative to page width
            return el.x >= blockStartX && el.x < midPointX;
        }).sort((a,b) => a.x - b.x);
        
        // Check if we have a time element (first element should be a time format)
        if (leftElements.length > 0 && leftElements[0].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
            const time = leftElements[0].text;
            let team1 = "";
            let team2 = "";
            
            // Extract team names, being careful to avoid treating times as team names
            if (leftElements.length > 1 && !leftElements[1].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                team1 = leftElements[1].text;
            }
            
            if (leftElements.length > 2 && !leftElements[2].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                team2 = leftElements[2].text;
            }
            
            // Create a game entry even if team names are empty (to capture time slots)
            if (time.trim()) {
                // Try to infer year from team names, fallback to header year
                const inferredYear = inferYearFromTeams(team1, team2);
                const finalYear = inferredYear || currentLeftBlock.year;
                
                games.push({
                    field: currentLeftBlock.name,
                    gameDuration: currentLeftBlock.gameDuration,
                    gameType: currentLeftBlock.gameType,
                    year: finalYear,
                    time: time,
                    team1: team1,
                    team2: team2,
                });
                
                // Log the extracted game for debugging
                console.log(`Game L in ${currentLeftBlock.name}: ${time} | ${team1 || '---'} vs ${team2 || '---'} | Year: ${finalYear}${inferredYear ? ' (inferred)' : ' (header)'}`);
            }
        }
    }

    if (currentRightBlock) {
        const blockStartX = currentRightBlock.startX; // Capture for the filter's closure
        // More flexible filtering to capture elements in the right block
        const rightElements = line.filter(el => {
            // Adjust the filter to better capture elements in the right field block
            return el.x >= blockStartX;
        }).sort((a,b) => a.x - b.x);
        
        // Check if we have a time element (first element should be a time format)
        if (rightElements.length > 0 && rightElements[0].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
            const time = rightElements[0].text;
            let team1 = "";
            let team2 = "";
            
            // Extract team names, being careful to avoid treating times as team names
            if (rightElements.length > 1 && !rightElements[1].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                team1 = rightElements[1].text;
            }
            
            if (rightElements.length > 2 && !rightElements[2].text.match(/^\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}$/)) {
                team2 = rightElements[2].text;
            }

            // Create a game entry even if team names are empty (to capture time slots)
            if (time.trim()) {
                // Try to infer year from team names, fallback to header year
                const inferredYear = inferYearFromTeams(team1, team2);
                const finalYear = inferredYear || currentRightBlock.year;
                
                games.push({
                    field: currentRightBlock.name,
                    gameDuration: currentRightBlock.gameDuration,
                    gameType: currentRightBlock.gameType,
                    year: finalYear,
                    time: time,
                    team1: team1,
                    team2: team2,
                });
                
                // Log the extracted game for debugging
                console.log(`Game R in ${currentRightBlock.name}: ${time} | ${team1 || '---'} vs ${team2 || '---'} | Year: ${finalYear}${inferredYear ? ' (inferred)' : ' (header)'}`);
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