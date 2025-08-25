#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './database.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function migrateJsonToDatabase() {
    const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || path.join(__dirname, '../persistent_app_files');
    const jsonFilePath = path.join(PERSISTENT_STORAGE_BASE_PATH, 'extracted_games_output.json');
    try {
        console.log('🔄 Starting migration from JSON to database...');
        // Check if JSON file exists
        try {
            await fs.access(jsonFilePath);
            console.log(`✅ Found JSON file: ${jsonFilePath}`);
        }
        catch (error) {
            console.log(`❌ No JSON file found at ${jsonFilePath}`);
            console.log('Nothing to migrate. Exiting.');
            return;
        }
        // Read and parse JSON data
        const jsonContent = await fs.readFile(jsonFilePath, 'utf-8');
        const jsonData = JSON.parse(jsonContent);
        console.log(`📊 Found ${jsonData.games.length} games in JSON file`);
        console.log(`📅 Document date: ${jsonData.documentDate}`);
        // Initialize database
        const db = await getDatabase();
        console.log('✅ Database connection established');
        // Start processing session
        const processingId = await db.startProcessing('migrated_from_json.pdf', jsonData.documentDate);
        console.log(`🆔 Started processing session: ${processingId}`);
        // Save games to database
        const savedCount = await db.saveGamesData(processingId, jsonData);
        console.log(`✅ Successfully migrated ${savedCount} games to database`);
        // Verify migration
        const dbSummary = await db.getGamesSummary();
        console.log('📈 Database summary after migration:');
        console.log(`  - Total games: ${dbSummary.totalGames}`);
        console.log(`  - Total fields: ${dbSummary.totalFields}`);
        console.log(`  - Games with missing teams: ${dbSummary.gamesWithMissingTeams}`);
        console.log(`  - Latest document date: ${dbSummary.latestDocumentDate}`);
        // Create backup of original JSON file
        const backupPath = jsonFilePath.replace('.json', '_backup_pre_migration.json');
        await fs.copyFile(jsonFilePath, backupPath);
        console.log(`💾 Created backup of original JSON at: ${backupPath}`);
        console.log('🎉 Migration completed successfully!');
        console.log('\n📋 Next steps:');
        console.log('  1. Test the admin app to ensure database integration works');
        console.log('  2. Test the API endpoint to ensure it serves data from database');
        console.log('  3. If everything works, you can remove the backup file');
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}
// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    migrateJsonToDatabase()
        .then(() => {
        console.log('Migration script completed');
        process.exit(0);
    })
        .catch((error) => {
        console.error('Migration script failed:', error);
        process.exit(1);
    });
}
export { migrateJsonToDatabase };
