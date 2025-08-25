import fs from 'fs';
import path from 'path';
import { getDatabase } from './database.js';
// Get the persistent storage path from environment variable or use default
const persistentStoragePath = process.env.APP_FILE_STORAGE_PATH || process.env.APP_PERSISTENT_STORAGE_PATH ||
    path.join(__dirname, '../persistent_app_files');
// Output file path
const summaryOutputPath = path.join(persistentStoragePath, 'games_summary.txt');
/**
 * Generate a summary of all games organized by field
 */
async function generateGamesSummary() {
    try {
        console.log(`Reading games from database...`);
        // Read the games data from database
        const db = await getDatabase();
        const gameData = await db.exportGamesAsJSON();
        // Extract the games array from the database data
        const games = gameData.games || [];
        console.log(`Found ${games.length} games in total`);
        // Group games by field
        const gamesByField = {};
        games.forEach(game => {
            if (!gamesByField[game.field]) {
                gamesByField[game.field] = [];
            }
            gamesByField[game.field].push(game);
        });
        // Sort fields alphabetically
        const sortedFields = Object.keys(gamesByField).sort();
        // Generate summary text
        let summaryText = `# Games Summary\nGenerated on: ${new Date().toLocaleString()}\n\n`;
        summaryText += `Total games found: ${games.length}\n`;
        summaryText += `Total fields found: ${sortedFields.length}\n\n`;
        // Add games by field
        sortedFields.forEach(field => {
            const fieldGames = gamesByField[field];
            summaryText += `## ${field}\n\n`;
            // Group by year/league
            const gamesByYear = {};
            fieldGames.forEach(game => {
                if (!gamesByYear[game.year]) {
                    gamesByYear[game.year] = [];
                }
                gamesByYear[game.year].push(game);
            });
            // Sort years
            const sortedYears = Object.keys(gamesByYear).sort();
            sortedYears.forEach(year => {
                summaryText += `### ${year} - ${gamesByYear[year][0].gameType}\n\n`;
                // Sort games by time
                const sortedGames = gamesByYear[year].sort((a, b) => {
                    // Extract start time for sorting
                    const timeA = a.time.split(' - ')[0];
                    const timeB = b.time.split(' - ')[0];
                    return timeA.localeCompare(timeB);
                });
                sortedGames.forEach(game => {
                    // Format as requested: time - team1 vs team2
                    const team1Display = game.team1 ? game.team1 : "No opponent";
                    const team2Display = game.team2 ? game.team2 : "No opponent";
                    summaryText += `${game.time} - ${team1Display} vs ${team2Display}\n`;
                });
                summaryText += '\n';
            });
        });
        // Write summary to file
        fs.writeFileSync(summaryOutputPath, summaryText);
        console.log(`Summary written to: ${summaryOutputPath}`);
        // Also output to console
        console.log('\n' + summaryText);
        return summaryText;
    }
    catch (error) {
        console.error('Error generating games summary:', error);
        throw error;
    }
}
// Run the function immediately when this script is executed directly
// In ES modules, we can't check require.main === module, so we just run it
generateGamesSummary()
    .then(() => console.log('Summary generation complete'))
    .catch(err => {
    console.error('Failed to generate summary:', err);
    process.exit(1);
});
export { generateGamesSummary };
