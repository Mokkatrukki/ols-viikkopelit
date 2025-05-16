import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Define the GameInfo interface (can be moved to a shared types file later)
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

// Serve static files (CSS, images, etc.) - we'll create a public folder later
// app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req: Request, res: Response) => {
  const teams = new Set<string>();
  allGames.forEach(game => {
    if (game.team1) teams.add(game.team1);
    if (game.team2) teams.add(game.team2);
  });
  const sortedTeams = Array.from(teams).sort();
  res.render('index', { teams: sortedTeams, selectedTeam: null, gamesForTeam: [] });
});

app.get('/team/:teamName', (req: Request, res: Response) => {
  const teamName = decodeURIComponent(req.params.teamName);
  const gamesForTeam = allGames.filter(
    game => game.team1 === teamName || game.team2 === teamName
  ).map(game => {
    const opponent = game.team1 === teamName ? game.team2 : game.team1;
    return { ...game, opponent: opponent || 'VASTUSTAJA PUUTTUU' }; // Handle cases with missing opponent
  });

  const teams = new Set<string>();
  allGames.forEach(game => {
    if (game.team1) teams.add(game.team1);
    if (game.team2) teams.add(game.team2);
  });
  const sortedTeams = Array.from(teams).sort();

  res.render('index', { teams: sortedTeams, selectedTeam: teamName, gamesForTeam });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
}); 