const line = "Ruotsi 17 AIK - Belgia 17 Anderlecht  1x20min";
console.log('Parsing:', line);

const parts = line.split('-').map(s => s.trim());
console.log('Parts:', parts);

const normalize = (team) => team.toLowerCase().trim().replace(/\s+/g, ' ');
console.log('Normalized team1:', normalize(parts[0]));
console.log('Normalized team2:', normalize(parts[1]));
