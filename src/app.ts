import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Define the GameInfo interface (can be moved to a shared types file later)
interface GameInfo {
  field: string;
  gameDuration: string;
  gameType: string;
  year: string; // This is the game's league/season year, e.g., "2017 EP"
  time: string;
  team1: string;
  team2: string;
}

// Helper function to extract the base year (e.g., "2017" from "2017 EP")
function getBaseYear(gameYear: string): string {
    const match = gameYear.match(/^(\d{4})/); // Extracts the first 4 digits
    return match ? match[1] : "Muut"; // Default to "Muut" if no 4-digit year found
}

interface GroupedTeamEntry {
  year: string; // This will be the base year like "2017"
  teams: string[];
}

// Helper function to parse HH.MM time to minutes since midnight
function parseTimeToMinutes(timeHM: string): number {
    const parts = timeHM.split('.');
    if (parts.length !== 2) return NaN; // Invalid format
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) return NaN;
    return hours * 60 + minutes;
}

// Helper function to get the start time of a game in minutes
function getGameStartTimeInMinutes(game: GameInfo): number {
    const timeParts = game.time.split(' - ');
    if (timeParts.length > 0) {
        return parseTimeToMinutes(timeParts[0]);
    }
    return NaN; // Should not happen with valid data
}

// Define fieldMapData here
const fieldMapData: { [key: string]: string } = {
    "HEINÄPÄÄN TEKONURMI A": '/images/tekonurmi_map_kentta_a.png',
    "HEINÄPÄÄN TEKONURMI B": '/images/tekonurmi_map_kentta_b.png',
    "HEINÄPÄÄN TEKONURMI C": '/images/tekonurmi_map_kentta_c.png',
    "HEINÄPÄÄN TEKONURMI D": '/images/tekonurmi_map_kentta_d.png',

    "GARAM MASALA 1A": '/images/garam_masala_map_kentta_1a.png',
    "GARAM MASALA 1B": '/images/garam_masala_map_kentta_1b.png',
    "GARAM MASALA 1C": '/images/garam_masala_map_kentta_1c.png',
    "GARAM MASALA 1D": '/images/garam_masala_map_kentta_1d.png',
    "GARAM MASALA 2A": '/images/garam_masala_map_kentta_2a.png',
    "GARAM MASALA 2B": '/images/garam_masala_map_kentta_2b.png',
    "GARAM MASALA 2C": '/images/garam_masala_map_kentta_2c.png',
    "GARAM MASALA 2D": '/images/garam_masala_map_kentta_2d.png',

    "HEPA - HALLI A": '/images/heinapaan_halli_map_kentta_a.png',
    "HEPA - HALLI B": '/images/heinapaan_halli_map_kentta_b.png',
    "HEPA - HALLI C": '/images/heinapaan_halli_map_kentta_c.png',
    "HEPA - HALLI D": '/images/heinapaan_halli_map_kentta_d.png'
};

// Helper function to get all unique teams and group them by extracted year
function getGroupedTeams(allGamesData: GameInfo[]): GroupedTeamEntry[] {
    const teamsByBaseYear: Record<string, Set<string>> = {};

    allGamesData.forEach(game => {
        const baseYear = getBaseYear(game.year);
        if (!teamsByBaseYear[baseYear]) {
            teamsByBaseYear[baseYear] = new Set<string>();
        }
        if (game.team1 && game.team1.trim() !== "") {
            teamsByBaseYear[baseYear].add(game.team1);
        }
        if (game.team2 && game.team2.trim() !== "") {
            teamsByBaseYear[baseYear].add(game.team2);
        }
    });

    const result: GroupedTeamEntry[] = [];
    Object.keys(teamsByBaseYear).sort((a, b) => {
        // Sort "Muut" last, otherwise numerically by year
        if (a === "Muut") return 1;
        if (b === "Muut") return -1;
        return parseInt(a, 10) - parseInt(b, 10);
    }).forEach(baseYear => {
        result.push({
            year: baseYear,
            teams: Array.from(teamsByBaseYear[baseYear]).sort()
        });
    });

    return result;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

// Path to the JSON data
const jsonDataPath = path.join(__dirname, '..', 'extracted_games_output.json');
let allGames: GameInfo[] = [];

// Read and parse the JSON data
try {
  const fileContent = fs.readFileSync(jsonDataPath, 'utf-8');
  allGames = JSON.parse(fileContent);
  console.log(`Successfully loaded ${allGames.length} games.`);
} catch (error) {
  console.error('Error reading or parsing game data:', error);
  // Exit or provide default empty data if the file is critical and not found
  process.exit(1); 
}

// Set view engine to EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views')); // Assuming views are in project_root/views

// Serve static files (CSS, images, etc.)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req: Request, res: Response) => {
  const groupedTeams = getGroupedTeams(allGames);
  res.render('index', { groupedTeams, selectedTeam: null, gamesForTeam: [], fieldMapData });
});

app.get('/team/:teamName', (req: Request, res: Response) => {
  const teamName = decodeURIComponent(req.params.teamName);
  let gamesForTeam = allGames
    .filter(game => game.team1 === teamName || game.team2 === teamName)
    .map(game => {
      const opponent = game.team1 === teamName ? game.team2 : game.team1;
      return { ...game, opponent: opponent || 'VASTUSTAJA PUUTTUU' };
    });

  // Sort games by start time
  gamesForTeam.sort((a, b) => {
    const startTimeA = getGameStartTimeInMinutes(a);
    const startTimeB = getGameStartTimeInMinutes(b);
    if (isNaN(startTimeA) || isNaN(startTimeB)) return 0; // Keep order if times are invalid
    return startTimeA - startTimeB;
  });

  // Calculate break time between games
  for (let i = 1; i < gamesForTeam.length; i++) {
    const currentGame = gamesForTeam[i] as any; // Use any to add new property
    const previousGame = gamesForTeam[i - 1];

    const previousGameEndTimeParts = previousGame.time.split(' - ');
    if (previousGameEndTimeParts.length === 2) {
        const previousGameEndTimeMinutes = parseTimeToMinutes(previousGameEndTimeParts[1]);
        const currentGameStartTimeMinutes = getGameStartTimeInMinutes(currentGame);

        if (!isNaN(previousGameEndTimeMinutes) && !isNaN(currentGameStartTimeMinutes)) {
            const breakDuration = currentGameStartTimeMinutes - previousGameEndTimeMinutes;
            if (breakDuration > 0) {
                currentGame.breakDurationMinutes = breakDuration;
            }
        }
    }
  }

  const groupedTeams = getGroupedTeams(allGames);

  res.render('index', { groupedTeams, selectedTeam: teamName, gamesForTeam, fieldMapData });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
}); 