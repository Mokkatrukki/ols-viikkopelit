#!/usr/bin/env node

// Test script for main app database functionality
import { getDatabase } from './dist/database.js';

async function testMainAppDatabase() {
    console.log('🧪 Testing main app database functionality...');
    
    try {
        // Get database instance
        const db = await getDatabase();
        console.log('✅ Database connection established');
        
        // Check game count
        const gameCount = await db.getGameCount();
        console.log(`📊 Found ${gameCount} games in database`);
        
        if (gameCount > 0) {
            // Get current game data
            const gameData = await db.getCurrentGameData();
            console.log(`📅 Document date: ${gameData.documentDate}`);
            console.log(`📄 Source file: ${gameData.sourceFile || 'N/A'}`);
            
            // Show sample games
            const sampleGames = gameData.games.slice(0, 3);
            console.log('\n📋 Sample games:');
            sampleGames.forEach((game, index) => {
                console.log(`${index + 1}. ${game.time} | ${game.team1} vs ${game.team2} | ${game.field}`);
            });
            
            // Test team-specific query
            if (sampleGames.length > 0) {
                const testTeam = sampleGames[0].team1;
                const teamGames = await db.getGamesForTeam(testTeam);
                console.log(`\n🏆 Found ${teamGames.length} games for team: ${testTeam}`);
            }
        } else {
            console.log('ℹ️ No games in database. Use admin app to populate data.');
        }
        
        await db.close();
        console.log('✅ Database test completed successfully!');
        
    } catch (error) {
        console.error('❌ Database test failed:', error);
        process.exit(1);
    }
}

testMainAppDatabase().catch(console.error);
