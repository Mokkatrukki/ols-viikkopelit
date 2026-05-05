import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const OLS_PAGE = 'https://ols.fi/jalkapallo/viikkopelit/';
const DATA_DIR = path.join(import.meta.dir, '../data');

export interface PdfInfo {
  url: string;
  localPath: string;
  date: Date;
  hash: string;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function parsePdfUrlDate(url: string): Date | null {
  // Pattern: Viikkopelit-7_5_2026.pdf
  const m = url.match(/Viikkopelit-(\d+)_(\d+)_(\d{4})\.pdf/i);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
}

function extractPdfUrls(html: string): string[] {
  const urls = new Set<string>();
  const pattern = /href="([^"]*Viikkopelit[^"]*\.pdf)"/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    let url = m[1];
    if (url.startsWith('/')) url = 'https://ols.fi' + url;
    else if (!url.startsWith('http')) url = 'https://ols.fi/' + url;
    urls.add(url);
  }
  return [...urls];
}

function findLatest(urls: string[]): PdfInfo | null {
  let latest: PdfInfo | null = null;

  for (const url of urls) {
    const date = parsePdfUrlDate(url);
    if (!date) continue;

    const d = date.getDate();
    const mo = date.getMonth() + 1;
    const y = date.getFullYear();
    const localPath = path.join(DATA_DIR, `viikkopelit-${d}_${mo}_${y}.pdf`);

    if (!latest || date > latest.date) {
      latest = { url, localPath, date };
    }
  }

  return latest;
}

async function downloadPdf(url: string, localPath: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'OLS-viikkopelit-bot/2.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading PDF from ${url}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buffer);
  console.log(`Downloaded: ${localPath}`);
  return buffer;
}

export async function fetchLatestPdf(): Promise<PdfInfo | null> {
  console.log(`Fetching OLS page: ${OLS_PAGE}`);

  const res = await fetch(OLS_PAGE, {
    headers: { 'User-Agent': 'OLS-viikkopelit-bot/2.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${OLS_PAGE}`);

  const html = await res.text();
  const urls = extractPdfUrls(html);
  console.log(`Found ${urls.length} viikkopelit PDF URL(s):`, urls);

  const latest = findLatest(urls);
  if (!latest) {
    console.warn('No parseable viikkopelit PDFs found on page');
    return null;
  }

  console.log(`Latest: ${latest.url} (${latest.date.toLocaleDateString('fi-FI')})`);

  if (fs.existsSync(latest.localPath)) {
    const existing = fs.readFileSync(latest.localPath);
    const existingHash = sha256(existing);

    // Re-download to check if OLS replaced the file with same name
    let freshBuffer: Buffer;
    try {
      freshBuffer = await downloadPdf(latest.url, latest.localPath);
    } catch {
      console.warn('Re-download failed, using cached file');
      return { ...latest, hash: existingHash };
    }

    const freshHash = sha256(freshBuffer);
    if (freshHash !== existingHash) {
      console.log(`PDF content changed (hash mismatch) → will re-parse`);
    } else {
      console.log(`PDF unchanged (hash match): ${latest.localPath}`);
    }
    return { ...latest, hash: freshHash };
  }

  const buffer = await downloadPdf(latest.url, latest.localPath);
  return { ...latest, hash: sha256(buffer) };
}

if (import.meta.main) {
  const result = await fetchLatestPdf();
  if (result) {
    console.log(`PDF ready: ${result.localPath}`);
  } else {
    console.error('No PDF found');
    process.exit(1);
  }
}
