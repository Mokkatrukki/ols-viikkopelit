import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

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
 * Excel stores dates as numbers (days since 1900-01-01)
 */
function excelDateToString(excelDate: number): string {
  // Excel date: days since 1900-01-01 (with 1900 leap year bug)
  const excelEpoch = new Date(1899, 11, 30); // December 30, 1899
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

  // Look for known locations
  if (str.includes('Kempele Areena') ||
      str.includes('Kurikkahaantien halli')) {
    return str.replace(/\s+/g, ' '); // Normalize whitespace
  }

  return null;
}

/**
 * Extract game duration from cell value
 * Example: "PELIAIKA 25MIN"
 */
function extractGameDuration(cellValue: any): string | null {
  if (!cellValue) return null;

  const str = String(cellValue);
  const match = str.match(/PELIAIKA\s*(\d+MIN)/i);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Parse time from cell value
 * Examples: 0.354166666666667 (Excel time) -> "08:30"
 */
function parseTime(cellValue: any): string | null {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null;

  // If it's already a string that looks like time
  if (typeof cellValue === 'string') {
    const timeMatch = cellValue.match(/^\d{1,2}:\d{2}$/);
    if (timeMatch) return cellValue;
  }

  // If it's a number (Excel time format: fraction of 24 hours)
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
 * Examples: "Ajax P9 Valkoinen" -> "2009"
 *           "Tervarit 17 Musta" -> "2017"
 *           "Ajax T6/7" -> "2019" (T6 born around 2018-2019)
 */
function extractYearFromTeam(teamName: string): string {
  if (!teamName) return '';

  const currentYear = new Date().getFullYear();
  const currentYearShort = currentYear % 100;

  // Look for patterns like "P9", "T9", "17", "18", etc.
  const patterns = [
    /[PT](\d{1,2})/i,  // P9, P10, P17, T9, T19, etc.
    /\s(\d{2})\s/,      // " 17 ", " 18 ", etc.
  ];

  for (const pattern of patterns) {
    const match = teamName.match(pattern);
    if (match) {
      let num = parseInt(match[1]);

      // Determine if this is a birth year or age group
      if (num <= currentYearShort) {
        // Likely a year like 17, 18, 19, 20 -> 2017, 2018, 2019, 2020
        return `20${num.toString().padStart(2, '0')}`;
      } else if (num < 30) {
        // Might be age or older years
        // For P6-P10 style: current year - age
        // Rough estimate: if P6 in 2025, born in 2019
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
  if (sheetName.includes('5v5')) {
    return '5 v 5';
  } else if (sheetName.includes('4v4')) {
    return '4 v 4';
  }
  return '';
}

/**
 * Check if a cell value is likely a team name
 */
function isTeamName(value: any): boolean {
  if (!value || typeof value !== 'string') return false;

  const str = value.trim();

  // Exclude empty strings and instructions
  if (str.length === 0) return false;
  if (str.toLowerCase().includes('aloittavat joukkueet')) return false;
  if (str.toLowerCase().includes('tötsät löytyy')) return false;
  if (str.toLowerCase().includes('viimeiset joukkueet')) return false;
  if (str.toLowerCase().includes('kentät')) return false;

  // Must contain letters
  if (!/[a-zäöå]/i.test(str)) return false;

  return true;
}

/**
 * Parse a tournament sheet
 */
function parseSheet(worksheet: XLSX.WorkSheet, sheetName: string): Game[] {
  const games: Game[] = [];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

  let currentDate = '';
  let currentLocation = '';
  let currentGameDuration = '';
  const gameType = getGameType(sheetName);

  console.log(`\n=== Parsing sheet: ${sheetName} ===`);
  console.log(`Range: ${range.s.r} to ${range.e.r} rows, ${range.s.c} to ${range.e.c} cols`);

  // Iterate through rows
  for (let R = range.s.r; R <= range.e.r; R++) {
    // Get all cells in the row
    const rowCells: any[] = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: C })];
      rowCells.push(cell ? cell.v : null);
    }

    // Check for date (Excel date number in column 1 or 2)
    for (let C = 0; C < Math.min(5, rowCells.length); C++) {
      const val = rowCells[C];
      // Excel dates for 2025 are around 45000-46000
      if (typeof val === 'number' && val > 40000 && val < 50000) {
        currentDate = excelDateToString(val);
        console.log(`Found date at row ${R}, col ${C}: ${currentDate} (Excel: ${val})`);
        break;
      }
    }

    // Check for location
    for (let C = 0; C < Math.min(8, rowCells.length); C++) {
      const loc = extractLocation(rowCells[C]);
      if (loc) {
        currentLocation = loc;
        console.log(`Found location at row ${R}: ${currentLocation}`);
        break;
      }
    }

    // Check for game duration
    for (let C = 0; C < Math.min(8, rowCells.length); C++) {
      const duration = extractGameDuration(rowCells[C]);
      if (duration) {
        currentGameDuration = duration;
        console.log(`Found game duration at row ${R}: ${currentGameDuration}`);
        break;
      }
    }

    // Skip if this is a header row
    const rowText = rowCells.join(' ').toLowerCase();
    if (rowText.includes('peliaika') && rowText.includes('kenttä')) {
      console.log(`Skipping header row ${R}`);
      continue;
    }

    // Parse game rows
    // Expected pattern in row:
    // [empty] | Time | Team1 | Team2 | Time | Team1 | Team2 | ...
    // OR
    // Time | Team1 | Team2 | Time | Team1 | Team2 | ...

    let fieldNumber = 1;
    let C = 0;

    while (C < rowCells.length) {
      const timeValue = rowCells[C];
      const time = parseTime(timeValue);

      if (time) {
        // Found a time, next two should be teams
        const team1Value = rowCells[C + 1];
        const team2Value = rowCells[C + 2];

        if (isTeamName(team1Value) && isTeamName(team2Value)) {
          const team1 = String(team1Value).trim();
          const team2 = String(team2Value).trim();

          if (currentDate && currentLocation) {
            const year = extractYearFromTeam(team1) || extractYearFromTeam(team2) || '';

            const game: Game = {
              field: `Kenttä ${fieldNumber}`,
              gameDuration: currentGameDuration || (gameType === '5 v 5' ? '25MIN' : ''),
              gameType: gameType,
              year: year,
              time: time,
              team1: team1,
              team2: team2,
              date: currentDate,
              location: currentLocation
            };

            games.push(game);
            console.log(`  Row ${R}, Field ${fieldNumber}: ${time} - ${team1} vs ${team2}`);
          }

          fieldNumber++;
        }

        C += 3; // Move past time, team1, team2
      } else {
        C++; // Move to next column
      }
    }
  }

  console.log(`Total games parsed from ${sheetName}: ${games.length}`);
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

  // Parse relevant sheets
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

  const output: GameOutput = {
    documentDate: new Date().toLocaleDateString('fi-FI'),
    games: allGames
  };

  return output;
}

// Main execution
if (require.main === module) {
  const excelPath = process.argv[2] || path.join(__dirname, '../../admin_app/Talviliigan 2025-2026 Otteluohjelmat 4v4_5v5 .xlsx');
  const outputPath = process.argv[3] || path.join(__dirname, '../output/extracted_games_output.json');

  try {
    console.log('=== OLS Excel Tournament Parser ===\n');

    if (!fs.existsSync(excelPath)) {
      console.error(`Error: Excel file not found at ${excelPath}`);
      console.log('Usage: npm run parse [excel-file-path] [output-json-path]');
      process.exit(1);
    }

    const result = parseExcelFile(excelPath);

    // Create output directory if it doesn't exist
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write output
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

    console.log(`\n=== Parsing Complete ===`);
    console.log(`Total games extracted: ${result.games.length}`);
    console.log(`Output written to: ${outputPath}`);

    // Show sample of first few games
    console.log('\n=== Sample Games ===');
    result.games.slice(0, 5).forEach((game, idx) => {
      console.log(`\nGame ${idx + 1}:`);
      console.log(`  Date: ${game.date}`);
      console.log(`  Time: ${game.time}`);
      console.log(`  Location: ${game.location}`);
      console.log(`  Field: ${game.field}`);
      console.log(`  ${game.team1} vs ${game.team2}`);
      console.log(`  Type: ${game.gameType}, Duration: ${game.gameDuration}, Year: ${game.year}`);
    });

  } catch (error) {
    console.error('Error parsing Excel file:', error);
    process.exit(1);
  }
}

export { parseExcelFile, Game, GameOutput };
