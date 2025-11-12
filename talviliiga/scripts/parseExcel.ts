import XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

interface GameOutput {
  documentDate: string;
  games: Game[];
}

/**
 * Convert Excel date number to readable date string
 */
function excelDateToString(excelDate: number): string {
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + excelDate * 86400000);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return `${day}.${month}`;
}

/**
 * Extract location from cell value
 */
function extractLocation(cellValue: any): string | null {
  if (!cellValue) return null;
  const str = String(cellValue).trim();
  if (str.includes('Kempele Areena') || str.includes('Kurikkahaantien halli')) {
    return str.replace(/\s+/g, ' ');
  }
  return null;
}

/**
 * Extract game duration from cell value
 */
function extractGameDuration(cellValue: any): string | null {
  if (!cellValue) return null;
  const str = String(cellValue);
  const match = str.match(/PELIAIKA\s*(\d+MIN)/i);
  return match ? match[1] : null;
}

/**
 * Parse time from cell value
 */
function parseTime(cellValue: any): string | null {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null;

  if (typeof cellValue === 'string') {
    const timeMatch = cellValue.match(/^\d{1,2}:\d{2}$/);
    if (timeMatch) return cellValue;
  }

  if (typeof cellValue === 'number' && cellValue > 0 && cellValue < 1) {
    const totalMinutes = Math.round(cellValue * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  return null;
}

/**
 * Extract year from team name
 */
function extractYearFromTeam(teamName: string): string {
  if (!teamName) return '';

  const currentYear = new Date().getFullYear();
  const currentYearShort = currentYear % 100;

  const patterns = [
    /[PT](\d{1,2})/i,
    /\s(\d{2})\s/,
  ];

  for (const pattern of patterns) {
    const match = teamName.match(pattern);
    if (match) {
      let num = parseInt(match[1]);

      if (num <= currentYearShort) {
        return `20${num.toString().padStart(2, '0')}`;
      } else if (num < 30) {
        const estimatedBirthYear = currentYear - num;
        if (estimatedBirthYear > 2000 && estimatedBirthYear < currentYear) {
          return estimatedBirthYear.toString();
        }
      }
    }
  }

  return '';
}

/**
 * Determine game type based on sheet name
 */
function getGameType(sheetName: string): string {
  if (sheetName.includes('5v5')) return '5 v 5';
  if (sheetName.includes('4v4')) return '4 v 4';
  return '';
}

/**
 * Check if a cell value is likely a team name
 */
function isTeamName(value: any): boolean {
  if (!value || typeof value !== 'string') return false;
  const str = value.trim();
  if (str.length === 0) return false;
  if (str.toLowerCase().includes('aloittavat joukkueet')) return false;
  if (str.toLowerCase().includes('tötsät löytyy')) return false;
  if (str.toLowerCase().includes('viimeiset joukkueet')) return false;
  if (str.toLowerCase().includes('kentät')) return false;
  if (!/[a-zäöå]/i.test(str)) return false;
  return true;
}

/**
 * Parse a tournament sheet
 */
function parseSheet(worksheet: XLSX.WorkSheet, sheetName: string): Game[] {
  const games: Game[] = [];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const seenGames = new Set<string>(); // Track unique games to avoid duplicates

  let currentDate = '';
  let currentLocation = '';
  let currentGameDuration = '';
  const gameType = getGameType(sheetName);

  console.log(`\n=== Parsing sheet: ${sheetName} ===`);

  for (let R = range.s.r; R <= range.e.r; R++) {
    const rowCells: any[] = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
      rowCells.push(cell ? cell.v : null);
    }

    // Check for date
    for (let C = 0; C < Math.min(5, rowCells.length); C++) {
      const val = rowCells[C];
      if (typeof val === 'number' && val > 40000 && val < 50000) {
        currentDate = excelDateToString(val);
        console.log(`Found date: ${currentDate}`);
        break;
      }
    }

    // Check for location
    for (let C = 0; C < Math.min(8, rowCells.length); C++) {
      const loc = extractLocation(rowCells[C]);
      if (loc) {
        currentLocation = loc;
        console.log(`Found location: ${currentLocation}`);
        break;
      }
    }

    // Check for game duration
    for (let C = 0; C < Math.min(8, rowCells.length); C++) {
      const duration = extractGameDuration(rowCells[C]);
      if (duration) {
        currentGameDuration = duration;
        console.log(`Found duration: ${currentGameDuration}`);
        break;
      }
    }

    // Skip header rows
    const rowText = rowCells.join(' ').toLowerCase();
    if (rowText.includes('peliaika') && rowText.includes('kenttä')) {
      continue;
    }

    // Parse game rows
    let fieldNumber = 1;
    let C = 0;

    while (C < rowCells.length) {
      const timeValue = rowCells[C];
      const time = parseTime(timeValue);

      if (time) {
        const team1Value = rowCells[C + 1];
        const team2Value = rowCells[C + 2];

        if (isTeamName(team1Value) && isTeamName(team2Value)) {
          const team1 = String(team1Value).trim();
          const team2 = String(team2Value).trim();

          if (currentDate && currentLocation) {
            const year = extractYearFromTeam(team1) || extractYearFromTeam(team2) || '';

            // Create unique key to detect duplicates
            const gameKey = `${currentDate}|${time}|${team1}|${team2}|${currentLocation}|${fieldNumber}`;

            // Only add if we haven't seen this exact game before
            if (!seenGames.has(gameKey)) {
              seenGames.add(gameKey);

              games.push({
                field: `Kenttä ${fieldNumber}`,
                gameDuration: currentGameDuration || (gameType === '5 v 5' ? '25MIN' : ''),
                gameType: gameType,
                year: year,
                time: time,
                team1: team1,
                team2: team2,
                date: currentDate,
                location: currentLocation
              });
            }
          }

          fieldNumber++;
        }

        C += 3;
      } else {
        C++;
      }
    }
  }

  console.log(`Total games parsed: ${games.length}`);
  console.log(`Duplicates filtered: ${seenGames.size - games.length}`);
  return games;
}

/**
 * Main parser function
 */
function parseExcelFile(filePath: string): GameOutput {
  console.log(`Reading Excel file: ${filePath}`);

  const workbook = XLSX.readFile(filePath);
  console.log(`Found sheets: ${workbook.SheetNames.join(', ')}`);

  const allGames: Game[] = [];

  const sheetsToProcess = workbook.SheetNames.filter(name =>
    name.includes('5v5 turnaukset') || name.includes('4v4 turnaukset')
  );

  console.log(`Processing sheets: ${sheetsToProcess.join(', ')}`);

  for (const sheetName of sheetsToProcess) {
    const worksheet = workbook.Sheets[sheetName];
    const games = parseSheet(worksheet, sheetName);
    allGames.push(...games);
  }

  // Sort games by date and time
  allGames.sort((a, b) => {
    if (a.date !== b.date) {
      return (a.date || '').localeCompare(b.date || '');
    }
    return (a.time || '').localeCompare(b.time || '');
  });

  return {
    documentDate: new Date().toLocaleDateString('fi-FI'),
    games: allGames
  };
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const excelPath = process.argv[2] || path.join(__dirname, '../data/talviliiga.xlsx');
  const outputPath = process.argv[3] || path.join(__dirname, '../data/games.json');

  try {
    console.log('=== Talviliiga Excel Parser ===\n');

    if (!fs.existsSync(excelPath)) {
      console.error(`Error: Excel file not found at ${excelPath}`);
      console.log('Usage: npm run parse [excel-file-path] [output-json-path]');
      process.exit(1);
    }

    const result = parseExcelFile(excelPath);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

    console.log(`\n=== Parsing Complete ===`);
    console.log(`Total games extracted: ${result.games.length}`);
    console.log(`Output written to: ${outputPath}`);

    console.log('\n=== Sample Games ===');
    result.games.slice(0, 3).forEach((game, idx) => {
      console.log(`\nGame ${idx + 1}:`);
      console.log(`  ${game.date} ${game.time} - ${game.location}`);
      console.log(`  ${game.team1} vs ${game.team2}`);
      console.log(`  ${game.gameType}, ${game.gameDuration}`);
    });

  } catch (error) {
    console.error('Error parsing Excel file:', error);
    process.exit(1);
  }
}

export { parseExcelFile, Game, GameOutput };
