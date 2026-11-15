import { createHash } from 'crypto';

// Talviliiga 4v4 & 5v5 schedule, linked from
// https://sites.google.com/tervaritjuniorit.fi/talviliiga/etusivu ("4v4&5v5>>").
// The sheet is public, so the xlsx export works without auth.
// Override with SHEET_ID when a new season gets a new sheet.
export const SHEET_ID = process.env.SHEET_ID ?? '1r1X53TeJk9RGk751j2p2Mie_ARU7mjNWLJXo29-erWk';
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface SheetDownload {
  buffer: Buffer;
  hash: string;
  url: string;
}

export async function fetchSheet(): Promise<SheetDownload> {
  const res = await fetch(EXPORT_URL, {
    headers: { 'User-Agent': 'talviliiga-bot/2.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading sheet`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes(XLSX_MIME)) {
    // Private sheet / login page comes back as text/html
    throw new Error(`Unexpected content-type "${type}" – is the sheet still public?`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, hash: createHash('sha256').update(buffer).digest('hex'), url: SHEET_URL };
}

if (import.meta.main) {
  const out = process.argv[2] ?? 'data/talviliiga.xlsx';
  const sheet = await fetchSheet();
  await Bun.write(out, sheet.buffer);
  console.log(`Saved ${sheet.buffer.length} bytes to ${out} (sha256 ${sheet.hash.slice(0, 12)})`);
}
