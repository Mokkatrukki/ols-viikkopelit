const text = `16.40-17.00   2017   Kreikka 17 AEK - KKP 2017 Oranssi   Hollanti 17 Ajax - Ruotsi 17 AIK   Ruotsi 17 Djurgården -Belgia 17 Anderlecht   Espanja 17 Barcelona - Portugali 17 Benfica  17.05-17.25`;

const match = text.match(/(\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.?\d{2})\s+(\d{4})\s+(.*?)(?=\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.?\d{2}|Kenttä|$)/);
if (match) {
  console.log('Time:', match[1]);
  console.log('Year:', match[2]);  
  console.log('Games text:', match[3]);
  console.log('\nSplit by 3+ spaces:');
  const games = match[3].split(/\s{3,}/);
  games.forEach((g, i) => console.log(`  ${i}: "${g}"`));
}
