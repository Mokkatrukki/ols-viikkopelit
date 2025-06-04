import fs from 'fs/promises';
import path from 'path';

// Define the game interface based on the JSON structure
interface Game {
  field: string;
  time: string;
  team1: string;
  team2: string;
  year: string;
  gameDuration: string;
  gameType: string;
}

interface GameData {
  documentDate: string;
  games: Game[];
}

interface FieldSummary {
  fieldName: string;
  yearGroups: {
    [year: string]: {
      gameType: string;
      games: Game[];
    }
  }
}

/**
 * Generate a summary of all games organized by field
 * @param persistentStoragePath Path to the persistent storage directory
 * @param filterType Optional filter to apply to the games list (e.g., 'removeNoOpponent')
 * @returns Object containing the game summary data
 */
/**
 * Find the path to the extracted_games_output.json file by checking multiple possible locations
 * @param basePath The base path to start searching from
 * @returns The full path to the extracted_games_output.json file
 */
async function findExtractedGamesFile(basePath: string): Promise<string> {
  // List of possible locations to check in order
  const possiblePaths = [
    // Direct in the provided path
    path.join(basePath, 'extracted_games_output.json'),
    // In persistent_app_files subdirectory
    path.join(basePath, 'persistent_app_files', 'extracted_games_output.json'),
    // In /data (for production on Fly.io)
    '/data/extracted_games_output.json',
  ];
  
  // Try each path in order
  for (const filePath of possiblePaths) {
    try {
      await fs.access(filePath);
      console.log(`Found extracted games file at: ${filePath}`);
      return filePath;
    } catch (error) {
      console.log(`File not found at: ${filePath}`);
    }
  }
  
  throw new Error('Could not find extracted_games_output.json in any of the expected locations');
}

export async function generateDataSummary(persistentStoragePath: string, filterType?: 'removeNoOpponent' | null): Promise<{
  documentDate: string;
  totalGames: number;
  totalFields: number;
  fieldSummaries: FieldSummary[];
}> {
  try {
    // Find the extracted games file
    const extractedGamesPath = await findExtractedGamesFile(persistentStoragePath);
    
    // Read the extracted games data
    const rawData = await fs.readFile(extractedGamesPath, 'utf8');
    const parsedData: GameData = JSON.parse(rawData);
    let games = parsedData.games || []; // Make games mutable for filtering

    // Apply filter if specified
    if (filterType === 'removeNoOpponent') {
      games = games.filter(game => {
        // A game is considered 'no opponent vs no opponent' if both team1 and team2 are effectively empty.
        // An empty team is represented by !game.team1 or an empty string.
        const team1Exists = game.team1 && game.team1.trim() !== '';
        const team2Exists = game.team2 && game.team2.trim() !== '';
        return team1Exists || team2Exists; // Keep game if at least one team exists
      });
    }
    
    // Group games by field, deduplicating by time slot
    const gamesByField: Record<string, Game[]> = {};
    const gameKeys = new Set<string>(); // Track unique field+time combinations
    
    games.forEach(game => {
      // Create a unique key for each game based on field and time
      const gameKey = `${game.field}|${game.time}`;
      
      // Only add the game if we haven't seen this field+time combination before
      if (!gameKeys.has(gameKey)) {
        if (!gamesByField[game.field]) {
          gamesByField[game.field] = [];
        }
        gamesByField[game.field].push(game);
        gameKeys.add(gameKey);
      } else {
        console.log(`Skipping duplicate game for ${game.field} at ${game.time}`);
      }
    });
    
    // Sort fields alphabetically
    const sortedFields = Object.keys(gamesByField).sort();
    
    // Create field summaries
    const fieldSummaries: FieldSummary[] = sortedFields.map(fieldName => {
      const fieldGames = gamesByField[fieldName];
      
      // Group by year/league
      const gamesByYear: Record<string, {
        gameType: string;
        games: Game[];
      }> = {};
      
      fieldGames.forEach(game => {
        if (!gamesByYear[game.year]) {
          gamesByYear[game.year] = {
            gameType: game.gameType,
            games: []
          };
        }
        gamesByYear[game.year].games.push(game);
      });
      
      // Sort games within each year group by time
      Object.keys(gamesByYear).forEach(year => {
        gamesByYear[year].games.sort((a, b) => {
          // Extract start time for sorting
          const timeA = a.time.split(' - ')[0];
          const timeB = b.time.split(' - ')[0];
          return timeA.localeCompare(timeB);
        });
      });
      
      return {
        fieldName,
        yearGroups: gamesByYear
      };
    });
    
    return {
      documentDate: parsedData.documentDate,
      totalGames: games.length,
      totalFields: sortedFields.length,
      fieldSummaries
    };
  } catch (error) {
    console.error('Error generating games summary:', error);
    throw error;
  }
}

/**
 * Checks for potential issues in the game data
 * @param persistentStoragePath Path to the persistent storage directory
 * @returns Array of potential issues found in the data
 */
export async function checkDataIssues(persistentStoragePath: string): Promise<{ issues: string[], missingTeamGamesCount: number }> {
  try {
    // Find the extracted games file using the helper function
    const extractedGamesPath = await findExtractedGamesFile(persistentStoragePath);
    
    // Read the extracted games data
    const rawData = await fs.readFile(extractedGamesPath, 'utf8');
    const parsedData: GameData = JSON.parse(rawData);
    const games = parsedData.games || [];
    
    const issues: string[] = [];
    let missingTeamGamesCount = 0;
    
    // Check for empty team slots
    const emptyTeamGames = games.filter(game => !game.team1 || !game.team2);
    missingTeamGamesCount = emptyTeamGames.length;
    if (missingTeamGamesCount > 0) {
      issues.push(`Found ${missingTeamGamesCount} games with missing team information`);
    }
    
    // Check for duplicate games (same teams, same time, same field)
    const gameSignatures = new Set<string>();
    const duplicateGames: Game[] = [];
    
    games.forEach(game => {
      const signature = `${game.field}|${game.time}|${game.team1}|${game.team2}`;
      if (gameSignatures.has(signature)) {
        duplicateGames.push(game);
      } else {
        gameSignatures.add(signature);
      }
    });
    
    if (duplicateGames.length > 0) {
      issues.push(`Found ${duplicateGames.length} potential duplicate games`);
    }
    
    // Check for overlapping games on the same field
    const gamesByField: Record<string, Game[]> = {};
    games.forEach(game => {
      if (!gamesByField[game.field]) {
        gamesByField[game.field] = [];
      }
      gamesByField[game.field].push(game);
    });
    
    const overlappingGames: {field: string, time: string, count: number}[] = [];
    
    Object.entries(gamesByField).forEach(([field, fieldGames]) => {
      const timeSlots: Record<string, number> = {};
      
      fieldGames.forEach(game => {
        if (!timeSlots[game.time]) {
          timeSlots[game.time] = 0;
        }
        timeSlots[game.time]++;
      });
      
      Object.entries(timeSlots).forEach(([time, count]) => {
        if (count > 2) { // More than 2 games in the same time slot might be an issue
          overlappingGames.push({field, time, count});
        }
      });
    });
    
    if (overlappingGames.length > 0) {
      issues.push(`Found ${overlappingGames.length} time slots with potentially too many games scheduled`);
    }
    
    return { issues, missingTeamGamesCount };
  } catch (error) {
    console.error('Error checking data issues:', error);
    throw error;
  }
}
