const text = `18.05-18.25   2017   Kreikka 17 AEK - Ruotsi 17 Djurgården   KKP 2017 Oranssi - Espanja 17 Barcelona   Hollanti 17 Ajax - Portugali 17 Benfica   Ruotsi 17 AIK - Belgia 17 Anderlecht  1x20min`;

const match = text.match(/(\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.?\d{2})\s+(\d{4})\s+(.*?)(?=\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.?\d{2}|Kenttä|$)/);
if (match) {
  console.log('Games text:', match[3]);
  console.log('\nSplit by 3+ spaces:');
  const games = match[3].split(/\s{3,}/).map(g => g.trim()).filter(g => g.includes('-'));
  games.forEach((g, i) => console.log(`  ${i}: "${g}"`));
  console.log('\nTotal games:', games.length);
}
