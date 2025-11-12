import * as XLSX from 'xlsx';
import * as path from 'path';

const excelPath = process.argv[2] || path.join(__dirname, '../../admin_app/Talviliigan 2025-2026 Otteluohjelmat 4v4_5v5 .xlsx');

console.log(`Reading Excel file: ${excelPath}\n`);

const workbook = XLSX.readFile(excelPath);
console.log(`Found sheets: ${workbook.SheetNames.join(', ')}\n`);

// Inspect the 5v5 sheet
const sheet5v5 = workbook.Sheets['5v5 turnaukset'];
const sheet4v4 = workbook.Sheets['4v4 turnaukset'];

console.log('=== Inspecting 5v5 turnaukset (first 30 rows) ===');
const range5v5 = XLSX.utils.decode_range(sheet5v5['!ref'] || 'A1');
for (let R = 0; R < Math.min(30, range5v5.e.r); R++) {
  const row: string[] = [];
  for (let C = 0; C <= Math.min(12, range5v5.e.c); C++) {
    const cell = sheet5v5[XLSX.utils.encode_cell({ r: R, c: C })];
    row.push(cell && cell.v ? String(cell.v) : '');
  }
  console.log(`Row ${R}: ${row.join(' | ')}`);
}

console.log('\n=== Inspecting 4v4 turnaukset (first 30 rows) ===');
const range4v4 = XLSX.utils.decode_range(sheet4v4['!ref'] || 'A1');
for (let R = 0; R < Math.min(30, range4v4.e.r); R++) {
  const row: string[] = [];
  for (let C = 0; C <= Math.min(10, range4v4.e.c); C++) {
    const cell = sheet4v4[XLSX.utils.encode_cell({ r: R, c: C })];
    row.push(cell && cell.v ? String(cell.v) : '');
  }
  console.log(`Row ${R}: ${row.join(' | ')}`);
}
