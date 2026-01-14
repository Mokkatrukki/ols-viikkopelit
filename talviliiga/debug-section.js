import * as fs from 'fs';

const text = fs.readFileSync('./pdf-extracted-text.txt', 'utf-8');
const kentta2Match = text.match(/Kenttä 2A\s+Kenttä 2B\s+Kenttä 2C\s+Kenttä 2D(.*?)(?=OTTELUOHJELMA|$)/s);

if (kentta2Match) {
  const section = kentta2Match[1];
  const match = section.match(/18\.05-18\.25\s+2017\s+(.*?)(?=\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.?\d{2}|Kenttä|$)/s);
  if (match) {
    console.log('Games text for 18:05:');
    console.log(match[1]);
    console.log('\nSplit:');
    const games = match[1].split(/\s{3,}/).map(g => g.trim()).map(g => g.replace(/\s+\d+x\d+min$/i, '').trim());
    games.forEach((g, i) => console.log(`${i}: "${g}"`));
  }
}
