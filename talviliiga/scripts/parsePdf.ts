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

/**
 * Load team mappings from JSON file
 */
function loadTeamMappings(): TeamMappings {
  const mappingPath = path.join(__dirname, '../data/team-mappings.json');
  const content = fs.readFileSync(mappingPath, 'utf-8');
  return JSON.parse(content);
}

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
 * Get number of fields based on age group
 */
function getFieldCount(ageGroup: string): number {
  const year = parseInt(ageGroup);

  // 2019-2020: 3 games (fields 1A, 1B, 1C)
  if (year >= 2019) {
    return 3;
  }

  // 2017-2018: 4 games (fields 1A, 1B, 1C, 1D)
  if (year >= 2017) {
    return 4;
  }

  return 3;
}

/**
 * Parse a single game line from PDF text
 * Format: "Team1 - Team2"
 */
function parseGameLine(line: string, teamMappings: TeamMappings): { team1: string; team2: string } | null {
  const parts = line.split('-').map(s => s.trim());

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
 * Parse date from PDF (format: "OTTELUOHJELMA DD.MM.YYYY")
 */
function parseDate(text: string): string | null {
  const match = text.match(/OTTELUOHJELMA\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${day}.${month}.${year}`;
  }
  return null;
}

/**
 * Parse location from PDF (format: "PELIPAIKKA: LOCATION")
 */
function parseLocation(text: string): string | null {
  const match = text.match(/PELIPAIKKA:\s*([A-ZÄÖÅ\s]+?)(?:\s+\d|3\.)/i);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Parse PDF content and extract games
 */
function parsePdfContent(text: string, teamMappings: TeamMappings): GameOutput {
  const games: Game[] = [];

  // Extract metadata
  const fullDateMatch = parseDate(text);
  const location = parseLocation(text) || 'GARAM MASALA'; // Default location from PDF title

  if (!fullDateMatch) {
    console.error('❌ Could not find date in PDF');
    throw new Error('Date not found in PDF');
  }

  const [day, month, year] = fullDateMatch.split('.');
  const shortDate = `${parseInt(day)}.${parseInt(month)}`;

  console.log(`📅 Date: ${fullDateMatch} (${shortDate})`);
  console.log(`📍 Location: ${location}`);
  console.log(`\n=== Parsing games ===\n`);

  // Use regex to find all time slots with year and games
  // Pattern: "HH.MM - HH.MM  YYYY  Game1  Game2  Game3..."
  // Games are separated by multiple spaces (3+) and end before the next time slot or "Kenttä"
  const timeSlotRegex = /(\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.?\d{2})\s+(\d{4})\s+(.*?)(?=\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.?\d{2}|Kenttä|$)/g;

  let match;
  while ((match = timeSlotRegex.exec(text)) !== null) {
    const timeRange = match[1];
    const ageGroup = match[2];
    const gamesText = match[3].trim();

    const time = parseTimeRange(timeRange);
    if (!time || !gamesText) continue;

    // Split games by pattern "TeamA - TeamB" separated by 3 or more spaces
    // Example: "Hollanti 20 Ajax - Kreikka 20 Olympiakos   Belgia 20 Anderlecht - Kreikka 20 AEK"
    // Split on 3+ spaces and filter out junk
    const gameLines = gamesText
      .split(/\s{3,}/)
      .map(g => g.trim())
      .filter(g => g.includes(' - ') && !g.includes('OTTELUOHJELMA') && !g.includes('siirtymä'));

    if (gameLines.length === 0) {
      console.warn(`⚠️  No games found in slot: ${timeRange} ${ageGroup}`);
      continue;
    }

    processGameSlot(games, time, ageGroup, gameLines, teamMappings, shortDate, fullDateMatch, location);
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

  const gamesByDate: DateGroup[] = Array.from(gamesByDateMap.entries()).map(([date, games]) => ({
    date,
    fullDate: fullDateMatch,
    games
  }));

  return {
    documentDate: new Date().toLocaleDateString('fi-FI'),
    games,
    gamesByDate
  };
}

/**
 * Process a single time slot with multiple games
 */
function processGameSlot(
  games: Game[],
  time: string,
  ageGroup: string,
  gameLines: string[],
  teamMappings: TeamMappings,
  shortDate: string,
  fullDate: string,
  location: string
): void {
  const fieldCount = getFieldCount(ageGroup);
  const { duration, type } = getGameInfo(ageGroup);
  const year = `20${ageGroup.slice(-2)}`;

  console.log(`⏰ ${time} - Age ${ageGroup} (${type}, ${duration})`);

  const fieldLetters = ['A', 'B', 'C', 'D'];

  for (let i = 0; i < Math.min(gameLines.length, fieldCount); i++) {
    const gameLine = gameLines[i];
    const parsed = parseGameLine(gameLine, teamMappings);

    if (parsed) {
      const field = `Kenttä 1${fieldLetters[i]}`;

      games.push({
        field,
        gameDuration: duration,
        gameType: type,
        year,
        time,
        team1: parsed.team1,
        team2: parsed.team2,
        date: shortDate,
        location
      });

      console.log(`  ${field}: ${parsed.team1} vs ${parsed.team2}`);
    } else {
      console.warn(`  ⚠️  Could not parse game: "${gameLine}"`);
    }
  }

  console.log('');
}

/**
 * Extract text from PDF using pdfjs-dist
 */
async function extractTextFromPdf(filePath: string): Promise<string> {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDocument = await loadingTask.promise;

  let fullText = '';

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}

/**
 * Main parser function
 */
async function parsePdfFile(filePath: string): Promise<GameOutput> {
  console.log(`📄 Reading PDF file: ${filePath}\n`);

  const text = await extractTextFromPdf(filePath);

  console.log(`📊 PDF Info:`);
  console.log(`   Text length: ${text.length} chars\n`);


  const teamMappings = loadTeamMappings();
  console.log(`✅ Loaded ${Object.keys(teamMappings.teams).length} team mappings\n`);

  return parsePdfContent(text, teamMappings);
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
