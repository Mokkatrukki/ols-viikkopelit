const line = "Ruotsi 17 Djurgården -Belgia 17 Anderlecht";
console.log('Parsing:', line);

const parts = line.split('-').map(s => s.trim());
console.log('Parts after split and trim:', parts);
console.log('Parts length:', parts.length);

if (parts.length !== 2) {
  console.log('ERROR: Expected 2 parts, got', parts.length);
}

// Normalize
const normalize = (team) => team.toLowerCase().trim().replace(/\s+/g, ' ');
console.log('\nNormalized team1:', normalize(parts[0]));
console.log('Normalized team2:', normalize(parts[1]));
