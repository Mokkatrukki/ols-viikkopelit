#!/usr/bin/env node

// Simple test script to verify the admin API works with database-only approach
const fetch = require('node:fetch');

async function testAdminAPI() {
  console.log('🧪 Testing Admin API with database-only approach...\n');
  
  try {
    const response = await fetch('http://localhost:3003/api/internal/latest-games-data', {
      headers: {
        'x-api-key': 'SUPER_SECRET_ADMIN_KEY_PLACEHOLDER_NEVER_USE_IN_PROD'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    console.log('✅ API Response successful!');
    console.log(`📊 Total games: ${data.games ? data.games.length : 0}`);
    console.log(`📅 Document date: ${data.documentDate}`);
    console.log(`📄 Source file: ${data.sourceFile || 'N/A'}`);
    
    if (data.games && data.games.length > 0) {
      console.log('\n🏟️  Sample games:');
      data.games.slice(0, 3).forEach((game, index) => {
        console.log(`  ${index + 1}. ${game.field} | ${game.time} | ${game.team1} vs ${game.team2}`);
      });
    }
    
    console.log('\n🎉 Database-only admin app is working perfectly!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testAdminAPI();
