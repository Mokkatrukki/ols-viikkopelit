#!/usr/bin/env node

// Test script to debug team grouping logic
import fs from 'fs';
import path from 'path';

// Load the game data
const dataPath = './admin_app/persistent_app_files/extracted_games_output.json';

if (!fs.existsSync(dataPath)) {
    console.error('❌ Game data file not found at:', dataPath);
    process.exit(1);
}

const rawData = fs.readFileSync(dataPath, 'utf-8');
const gameData = JSON.parse(rawData);

console.log('🔍 TEAM GROUPING DEBUG TEST');
console.log('=' .repeat(50));
console.log(`📅 Document Date: ${gameData.documentDate}`);
console.log(`🎮 Total Games: ${gameData.games.length}`);
console.log();

// Extract all unique team names
const allTeamNames = new Set();
gameData.games.forEach(game => {
    if (game.team1 && game.team1.trim() !== "") {
        allTeamNames.add(game.team1);
    }
    if (game.team2 && game.team2.trim() !== "") {
        allTeamNames.add(game.team2);
    }
});

const teamList = Array.from(allTeamNames).sort();
console.log('🏈 ALL UNIQUE TEAMS:');
console.log('-'.repeat(30));
teamList.forEach((team, index) => {
    console.log(`${(index + 1).toString().padStart(2, ' ')}. ${team}`);
});
console.log(`\n✅ Total unique teams: ${teamList.length}`);
console.log();

// Helper functions (copied from app.ts)
function longestCommonPrefix(str1, str2) {
    let i = 0;
    while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
        i++;
    }
    // Trim to last space to avoid cutting words in half
    const prefix = str1.substring(0, i);
    const lastSpaceIndex = prefix.lastIndexOf(' ');
    return lastSpaceIndex > 0 ? prefix.substring(0, lastSpaceIndex).trim() : prefix.trim();
}

function findTeamGroups(teamNames) {
    // First, find all possible groupings
    const allPossibleGroups = [];
    
    for (let i = 0; i < teamNames.length; i++) {
        for (let j = i + 1; j < teamNames.length; j++) {
            const team1 = teamNames[i];
            const team2 = teamNames[j];
            const commonPrefix = longestCommonPrefix(team1, team2);
            
            // Only consider meaningful prefixes
            const prefixWords = commonPrefix.split(/\s+/).filter(w => w.length > 0);
            const isMeaningfulPrefix = 
                (commonPrefix.length >= 10 && prefixWords.length >= 3) || // Long prefix with 3+ words
                (prefixWords.length >= 2 && prefixWords.every(word => word.length >= 2)); // 2+ words, each 2+ chars
            
            if (isMeaningfulPrefix) {
                // Find all teams that match this prefix
                const matchingTeams = teamNames.filter(team => 
                    team.startsWith(commonPrefix + ' ')
                );
                
                if (matchingTeams.length >= 2) {
                    allPossibleGroups.push({
                        prefix: commonPrefix,
                        teams: matchingTeams.sort()
                    });
                }
            }
        }
    }
    
    // Remove duplicate groups (same teams, different prefix length)
    const uniqueGroups = [];
    
    for (const group of allPossibleGroups) {
        const teamSet = new Set(group.teams);
        const isDuplicate = uniqueGroups.some(existing => {
            const existingSet = new Set(existing.teams);
            return teamSet.size === existingSet.size && 
                   [...teamSet].every(team => existingSet.has(team));
        });
        
        if (!isDuplicate) {
            uniqueGroups.push(group);
        } else {
            // If duplicate, keep the one with longer (more specific) prefix
            const existingIndex = uniqueGroups.findIndex(existing => {
                const existingSet = new Set(existing.teams);
                return teamSet.size === existingSet.size && 
                       [...teamSet].every(team => existingSet.has(team));
            });
            
            if (existingIndex !== -1 && group.prefix.length > uniqueGroups[existingIndex].prefix.length) {
                uniqueGroups[existingIndex] = group;
            }
        }
    }
    
    // Sort by specificity (longer prefix first) and group size
    uniqueGroups.sort((a, b) => {
        if (a.prefix.length !== b.prefix.length) {
            return b.prefix.length - a.prefix.length; // Longer prefix first
        }
        return b.teams.length - a.teams.length; // More teams first
    });
    
    // Select non-overlapping groups greedily (most specific first)
    const finalGroups = new Map();
    const usedTeams = new Set();
    
    for (const group of uniqueGroups) {
        const hasOverlap = group.teams.some(team => usedTeams.has(team));
        
        if (!hasOverlap && group.teams.length > 1) {
            finalGroups.set(group.prefix, group.teams);
            group.teams.forEach(team => usedTeams.add(team));
        }
    }
    
    return finalGroups;
}

// Test the grouping logic
console.log('🔗 TESTING TEAM GROUPING LOGIC:');
console.log('-'.repeat(40));

const teamGroups = findTeamGroups(teamList);

if (teamGroups.size === 0) {
    console.log('❌ NO TEAM GROUPS FOUND!');
    console.log();
    
    // Let's manually test some pairs to see what's happening
    console.log('🧪 MANUAL PAIR TESTING:');
    console.log('-'.repeat(25));
    
    // Test some obvious pairs
    const testPairs = [
        ['OLS Hollanti 20 Ajax', 'OLS Hollanti 20 PSV'],
        ['KKP - Nappulat 20 Sininen', 'KKP - Nappulat 20 Valkoinen'],
        ['OLS Belgia 20 Anderlecht', 'OLS Belgia 20 Brugge'],
        ['KKP P8 Keltainen', 'KKP P8 Musta'],
        ['KKP P8 Musta', 'KKP P8 Sininen'],
    ];
    
    testPairs.forEach(([team1, team2]) => {
        if (teamList.includes(team1) && teamList.includes(team2)) {
            const prefix = longestCommonPrefix(team1, team2);
            const prefixWords = prefix.split(/\s+/).filter(w => w.length > 0);
            console.log(`${team1} + ${team2}`);
            console.log(`  → Common prefix: "${prefix}" (${prefix.length} chars, ${prefixWords.length} words)`);
            const isMeaningful = (prefix.length >= 10 && prefixWords.length >= 3) || 
                                (prefixWords.length >= 2 && prefixWords.every(word => word.length >= 2));
            console.log(`  → Meets criteria: ${isMeaningful ? '✅' : '❌'}`);
        } else {
            console.log(`${team1} + ${team2} → One or both teams not found in data`);
        }
        console.log();
    });
    
} else {
    console.log(`✅ Found ${teamGroups.size} team groups:`);
    console.log();
    
    teamGroups.forEach((subteams, baseName) => {
        console.log(`📁 ${baseName}`);
        subteams.forEach(subteam => {
            const suffix = subteam.replace(baseName + ' ', '');
            console.log(`  ├── ${suffix} (${subteam})`);
        });
        console.log();
        
        // Debug KKP - Nappulat grouping specifically
        if (baseName.includes('Nappulat')) {
            console.log(`  🔍 DEBUG: KKP - Nappulat grouping analysis:`);
            subteams.forEach(team => {
                console.log(`    - ${team}`);
                subteams.forEach(otherTeam => {
                    if (team !== otherTeam) {
                        const prefix = longestCommonPrefix(team, otherTeam);
                        console.log(`      vs ${otherTeam} → "${prefix}" (${prefix.length} chars)`);
                    }
                });
            });
            console.log();
        }
    });
}

// Show teams that weren't grouped
const groupedTeams = new Set();
teamGroups.forEach(subteams => {
    subteams.forEach(team => groupedTeams.add(team));
});

const ungroupedTeams = teamList.filter(team => !groupedTeams.has(team));

if (ungroupedTeams.length > 0) {
    console.log('🔍 UNGROUPED TEAMS:');
    console.log('-'.repeat(20));
    ungroupedTeams.forEach(team => {
        console.log(`• ${team}`);
    });
    console.log(`\n📊 Ungrouped: ${ungroupedTeams.length} teams`);
} else {
    console.log('✅ All teams were successfully grouped!');
}

console.log();
console.log('🏁 TEST COMPLETE');