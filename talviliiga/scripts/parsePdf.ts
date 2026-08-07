import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Game {
  field: string;
  gameDuration: string;
  gameType: string;
  year: string;
  time: string;
  team1: string;
  team2: string;
  date?: string;
  location?: string;
}

interface DateGroup {
  date: string;
  fullDate: string;
  games: Game[];
}

interface GameOutput {
  documentDate: string;
  games: Game[];
  gamesByDate: DateGroup[];
}

interface TeamMappings {
  teams: { [key: string]: string };
  gameDates: string[];
}

interface TextItem {
  text: string;
  x: number;
  y: number;
}

interface ColumnBoundary {
  letter: string;
  minX: number;
  maxX: number;
  headerX: number;
}

/**
 * Load team mappings from JSON file
 */
function loadTeamMappings(): TeamMappings {
  const mappingPath = path.join(__dirname, '../data/team-mappings.json');
  const content = fs.readFileSync(mappingPath, 'utf-8');
  return JSON.parse(content);
}

/** Track unmapped team names and their occurrence counts */
const unmappedTeams = new Map<string, { original: string; normalized: string; count: number }>();

/** Track time slots where parsed game count doesn't match expected field count */
interface TimeSlotCheck {
  time: string;
  fieldSection: string;
  expectedGames: number;
  parsedGames: number;
  failedGames: string[];
}
const timeSlotChecks: TimeSlotCheck[] = [];

/**
 * Normalize team name for matching
 */
function normalizeTeamName(team: string): string {
  return team.toLowerCase().trim()
    .replace(/\s+/g, ' ');
}

/**
 * Map short team name from PDF to full team name
 */
function mapTeamName(shortName: string, teamMappings: TeamMappings): string {
  const normalized = normalizeTeamName(shortName);
  const fullName = teamMappings.teams[normalized];

  if (!fullName) {
    console.warn(`⚠️  Team mapping not found for: "${shortName}" (normalized: "${normalized}")`);
    const existing = unmappedTeams.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      unmappedTeams.set(normalized, { original: shortName, normalized, count: 1 });
    }
    return shortName; // Return original if no mapping found
  }

  return fullName;
}

/**
 * Parse game duration and type based on age group
 */
function getGameInfo(ageGroup: string): { duration: string; type: string } {
  const year = parseInt(ageGroup);

  // 2019-2020: 3v3, 15min
  if (year >= 2019) {
    return { duration: '15MIN', type: '3 v 3' };
  }

  // 2017-2018: 4v4, 20min
  if (year >= 2017) {
    return { duration: '20MIN', type: '4 v 4' };
  }

  return { duration: '15MIN', type: '3 v 3' };
}

/**
 * Parse a single game line from PDF text
 * Format: "Team1 - Team2"
 */
function parseGameLine(line: string, teamMappings: TeamMappings): { team1: string; team2: string } | null {
  const parts = line.split(/\s+-\s*|\s*-\s+/).map(s => s.trim());

  if (parts.length !== 2) {
    return null;
  }

  const team1 = mapTeamName(parts[0], teamMappings);
  const team2 = mapTeamName(parts[1], teamMappings);

  return { team1, team2 };
}

/**
 * Parse time from format "HH:MM - HH:MM" or "HH.MM - HH.MM"
 */
function parseTimeRange(timeStr: string): string | null {
  const match = timeStr.match(/(\d{1,2})[\.:]\s*(\d{2})\s*-\s*(\d{1,2})[\.:]\s*(\d{2})/);
  if (match) {
    const startHour = match[1].padStart(2, '0');
    const startMin = match[2];
    return `${startHour}:${startMin}`;
  }
  return null;
}

/**
 * Find column boundaries dynamically from column header positions in the PDF.
 * Looks for items like "Kenttä 1A", "Kenttä 1B", etc. and builds column ranges.
 */
function findColumnBoundaries(items: TextItem[], fieldPrefix: string): ColumnBoundary[] {
  // Find all column headers for this field prefix (e.g., "Kenttä 1A", "Kenttä 1B")
  const headerPattern = new RegExp(`^Kenttä ${fieldPrefix}([A-H])$`);
  const headers: { letter: string; x: number; y: number }[] = [];

  for (const item of items) {
    const match = item.text.match(headerPattern);
    if (match) {
      headers.push({ letter: match[1], x: item.x, y: item.y });
    }
  }

  if (headers.length === 0) {
    return [];
  }

  // Deduplicate headers (same header may appear multiple times at different y positions)
  // Group by letter and take the first occurrence
  const uniqueHeaders = new Map<string, { letter: string; x: number }>();
  for (const h of headers) {
    if (!uniqueHeaders.has(h.letter)) {
      uniqueHeaders.set(h.letter, { letter: h.letter, x: h.x });
    }
  }

  const sorted = Array.from(uniqueHeaders.values()).sort((a, b) => a.x - b.x);

  // Build boundaries using midpoints between headers
  const boundaries: ColumnBoundary[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const minX = i === 0 ? 0 : Math.round((sorted[i - 1].x + sorted[i].x) / 2);
    const maxX = i === sorted.length - 1 ? Infinity : Math.round((sorted[i].x + sorted[i + 1].x) / 2);

    boundaries.push({
      letter: sorted[i].letter,
      minX,
      maxX,
      headerX: sorted[i].x,
    });
  }

  return boundaries;
}

/**
 * Determine which field letter a game belongs to based on its x-position
 */
function getFieldLetterByPosition(x: number, boundaries: ColumnBoundary[]): string | null {
  for (const col of boundaries) {
    if (x >= col.minX && x < col.maxX) {
      return col.letter;
    }
  }
  return null;
}

/**
 * Extract text items from PDF with their x,y positions
 */
async function extractTextItems(filePath: string): Promise<TextItem[]> {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;

  const allItems: TextItem[] = [];

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();

    for (const item of textContent.items as any[]) {
      if (item.str.trim()) {
        allItems.push({
          text: item.str,
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        });
      }
    }
  }

  // Sort top-to-bottom (y descending), then left-to-right (x ascending)
  allItems.sort((a, b) => b.y - a.y || a.x - b.x);

  return allItems;
}

/**
 * Parse PDF content from positioned text items and extract games
 */
function parsePdfContent(items: TextItem[], teamMappings: TeamMappings): GameOutput {
  const games: Game[] = [];

  // Build flat text for metadata extraction
  const flatText = items.map(i => i.text).join(' ');

  // Extract metadata
  const dateMatch = flatText.match(/OTTELUOHJELMA\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (!dateMatch) {
    console.error('❌ Could not find date in PDF');
    throw new Error('Date not found in PDF');
  }
  const fullDateMatch = `${dateMatch[1].padStart(2, '0')}.${dateMatch[2].padStart(2, '0')}.${dateMatch[3]}`;
  const [day, month] = fullDateMatch.split('.');
  const shortDate = `${parseInt(day)}.${parseInt(month)}`;

  const locationMatch = flatText.match(/PELIPAIKKA:\s*([A-ZÄÖÅ\s]+?)(?:\s+\d|3\.)/i);
  const location = locationMatch ? locationMatch[1].trim() : 'GARAM MASALA';

  console.log(`📅 Date: ${fullDateMatch} (${shortDate})`);
  console.log(`📍 Location: ${location}`);

  // Find column boundaries for Kenttä 1 and Kenttä 2
  const boundaries1 = findColumnBoundaries(items, '1');
  const boundaries2 = findColumnBoundaries(items, '2');

  console.log(`📐 Kenttä 1 columns: ${boundaries1.map(b => `${b.letter}(x=${b.headerX})`).join(', ')}`);
  console.log(`📐 Kenttä 2 columns: ${boundaries2.map(b => `${b.letter}(x=${b.headerX})`).join(', ')}`);
  console.log(`\n=== Parsing games ===\n`);

  // Find field section y-ranges by looking for "Kenttä 1 (...)" and "Kenttä 2 (...)" headers
  // and the repeated column header rows
  const sectionHeaders = items.filter(i => /^Kenttä [12] \(/.test(i.text));

  // Group items into rows by y-coordinate (items within 3px are same row)
  const rowMap = new Map<number, TextItem[]>();
  for (const item of items) {
    let foundRow = false;
    for (const [rowY] of rowMap) {
      if (Math.abs(item.y - rowY) <= 3) {
        rowMap.get(rowY)!.push(item);
        foundRow = true;
        break;
      }
    }
    if (!foundRow) {
      rowMap.set(item.y, [item]);
    }
  }

  // Sort rows by y descending (top to bottom)
  const rows = Array.from(rowMap.entries())
    .sort(([a], [b]) => b - a)
    .map(([y, rowItems]) => ({
      y,
      items: rowItems.sort((a, b) => a.x - b.x),
    }));

  // Determine which field section each row belongs to by tracking section transitions
  // Section transitions happen at "Kenttä N (..." headers or column header rows
  let currentFieldPrefix: string | null = null;
  let currentBoundaries: ColumnBoundary[] = [];

  for (const row of rows) {
    const rowText = row.items.map(i => i.text).join(' ');

    // Check for section header like "Kenttä 1 (Vihreät maalit)"
    const sectionMatch = rowText.match(/Kenttä (\d) \(/);
    if (sectionMatch) {
      currentFieldPrefix = sectionMatch[1];
      currentBoundaries = currentFieldPrefix === '1' ? boundaries1 : boundaries2;
      continue;
    }

    // Check for column header row like "Kenttä 1A Kenttä 1B ..."
    if (row.items.some(i => /^Kenttä \d[A-H]$/.test(i.text))) {
      // Column header row - update section prefix from the headers
      const headerItem = row.items.find(i => /^Kenttä (\d)[A-H]$/.test(i.text));
      if (headerItem) {
        const prefixMatch = headerItem.text.match(/Kenttä (\d)/);
        if (prefixMatch) {
          currentFieldPrefix = prefixMatch[1];
          currentBoundaries = currentFieldPrefix === '1' ? boundaries1 : boundaries2;
        }
      }
      continue;
    }

    // Skip non-game rows
    if (!currentFieldPrefix || currentBoundaries.length === 0) continue;

    // Check if this row has a time slot
    const timeItem = row.items.find(i => /^\d{1,2}[\.:]\s*\d{2}\s*-\s*\d{1,2}[\.:]\s*\d{2}$/.test(i.text));
    const ageItem = row.items.find(i => /^\d{4}$/.test(i.text) && parseInt(i.text) >= 2010 && parseInt(i.text) <= 2025);

    if (!timeItem || !ageItem) continue;

    const time = parseTimeRange(timeItem.text);
    if (!time) continue;

    const ageGroup = ageItem.text;
    const { duration, type } = getGameInfo(ageGroup);
    const year = `20${ageGroup.slice(-2)}`;

    // Find game items in this row (items that contain " - " and are in the game columns area)
    // Game items are to the right of the age column
    const gameItems = row.items.filter(i =>
      i.x > ageItem.x + 30 &&
      i.text.includes('-') &&
      !i.text.match(/^\d{1,2}[\.:]\s*\d{2}\s*-\s*\d{1,2}/) && // not a time range
      !i.text.includes('OTTELUOHJELMA') &&
      !i.text.includes('siirtymä')
    );

    if (gameItems.length === 0) continue;

    console.log(`⏰ ${time} - Age ${ageGroup} (${type}, ${duration}) - ${gameItems.length} games`);

    let parsedCount = 0;
    const failedInSlot: string[] = [];

    for (const gameItem of gameItems) {
      // Clean the game text
      const cleanedText = gameItem.text.replace(/\s+\d+x\d+min.*$/i, '').trim();
      const parsed = parseGameLine(cleanedText, teamMappings);

      if (parsed) {
        const fieldLetter = getFieldLetterByPosition(gameItem.x, currentBoundaries);
        if (!fieldLetter) {
          console.warn(`  ⚠️  Could not determine field for game at x=${gameItem.x}: "${cleanedText}"`);
          failedInSlot.push(cleanedText);
          continue;
        }

        const field = `Kenttä ${currentFieldPrefix}${fieldLetter}`;

        games.push({
          field,
          gameDuration: duration,
          gameType: type,
          year,
          time,
          team1: parsed.team1,
          team2: parsed.team2,
          date: shortDate,
          location,
        });

        console.log(`  ${field}: ${parsed.team1} vs ${parsed.team2}`);
        parsedCount++;
      } else {
        console.warn(`  ⚠️  Could not parse game: "${cleanedText}"`);
        failedInSlot.push(cleanedText);
      }
    }

    timeSlotChecks.push({
      time,
      fieldSection: `Kenttä ${currentFieldPrefix}`,
      expectedGames: currentBoundaries.length,
      parsedGames: parsedCount,
      failedGames: failedInSlot,
    });

    console.log('');
  }

  // Group games by date
  const gamesByDateMap = new Map<string, Game[]>();
  games.forEach(game => {
    if (game.date) {
      if (!gamesByDateMap.has(game.date)) {
        gamesByDateMap.set(game.date, []);
      }
      gamesByDateMap.get(game.date)!.push(game);
    }
  });

  const gamesByDate: DateGroup[] = Array.from(gamesByDateMap.entries()).map(([date, dateGames]) => ({
    date,
    fullDate: fullDateMatch,
    games: dateGames,
  }));

  return {
    documentDate: new Date().toLocaleDateString('fi-FI'),
    games,
    gamesByDate,
  };
}

/**
 * Main parser function
 */
async function parsePdfFile(filePath: string): Promise<GameOutput> {
  console.log(`📄 Reading PDF file: ${filePath}\n`);

  const items = await extractTextItems(filePath);

  console.log(`📊 PDF Info:`);
  console.log(`   Text items: ${items.length}\n`);

  const teamMappings = loadTeamMappings();
  console.log(`✅ Loaded ${Object.keys(teamMappings.teams).length} team mappings\n`);

  return parsePdfContent(items, teamMappings);
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const pdfPath = process.argv[2] || path.join(__dirname, '../Talviliiga221125a.pdf');
  const outputPath = process.argv[3] || path.join(__dirname, '../data/games.json');

  try {
    console.log('=== Talviliiga PDF Parser ===\n');

    if (!fs.existsSync(pdfPath)) {
      console.error(`❌ Error: PDF file not found at ${pdfPath}`);
      console.log('Usage: npm run parse:pdf [pdf-file-path] [output-json-path]');
      process.exit(1);
    }

    const result = await parsePdfFile(pdfPath);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

    console.log(`\n=== Parsing Complete ===`);
    console.log(`✅ Total games extracted: ${result.games.length}`);
    console.log(`💾 Output written to: ${outputPath}`);

    // Print unmapped team summary
    if (unmappedTeams.size > 0) {
      console.log(`\n=== Unmapped Teams ===`);
      console.log(`Found ${unmappedTeams.size} unmapped team name(s):\n`);
      for (const [, info] of unmappedTeams) {
        console.log(`  "${info.original}" (normalized: "${info.normalized}") - ${info.count} occurrence(s)`);
      }
      console.log(`\nAdd these to data/team-mappings.json to resolve.`);
    } else {
      console.log(`\n✅ All teams mapped successfully.`);
    }

    // Print game count validation
    const missingSlots = timeSlotChecks.filter(s => s.parsedGames < s.expectedGames);
    if (missingSlots.length > 0) {
      console.log(`\n=== Missing Games ===`);
      console.log(`${missingSlots.length} time slot(s) have fewer games than expected:\n`);
      for (const slot of missingSlots) {
        const missing = slot.expectedGames - slot.parsedGames;
        console.log(`  ${slot.fieldSection} ${slot.time}: ${slot.parsedGames}/${slot.expectedGames} games (${missing} missing)`);
        for (const failed of slot.failedGames) {
          console.log(`    failed: "${failed}"`);
        }
      }
    } else {
      console.log(`\n✅ All time slots have expected game counts.`);
    }

    console.log('\n=== Sample Games ===');
    result.games.slice(0, 5).forEach((game, idx) => {
      console.log(`\nGame ${idx + 1}:`);
      console.log(`  ${game.date} ${game.time} - ${game.location}`);
      console.log(`  ${game.field}: ${game.team1} vs ${game.team2}`);
      console.log(`  ${game.gameType}, ${game.gameDuration}, Year: ${game.year}`);
    });

  } catch (error) {
    console.error('❌ Error parsing PDF file:', error);
    process.exit(1);
  }
}

export { parsePdfFile, Game, GameOutput, DateGroup };
