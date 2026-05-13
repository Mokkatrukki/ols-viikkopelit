import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const OLS_PAGE = 'https://ols.fi/jalkapallo/viikkopelit/';
const UPLOADS_BASE = 'https://ols.fi/wp-content/uploads';
const DATA_DIR = path.join(import.meta.dir, '../data');
const HEADERS = { 'User-Agent': 'OLS-viikkopelit-bot/2.0' };

// Matches "viikkopelit", "viikopelit", "VIIKKopelit", etc. — one or two k's, any case
const VIIKKOPELIT_RE = /viik+opelit/i;

export interface PdfInfo {
  url: string;
  localPath: string;
  date: Date;
  hash: string;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function parsePdfUrlDate(url: string): { date: Date; revision: number } | null {
  // "Viikkopelit-7_5_2026.pdf", "Viikkopelit-14_5_2026_b.pdf", "Viikkopelit-14_5_2026_korjaus.pdf"
  const m = url.match(/viik+opelit[-_\d]*[-_](\d{1,2})_(\d{1,2})_(\d{4})(?:_([a-z0-9]+))?\.pdf/i);
  if (!m) return null;
  const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Single letter suffix = revision letter (a=1, b=2...), longer suffix = later than base
  const sfx = m[4]?.toLowerCase() ?? '';
  const revision = sfx.length === 1 ? sfx.charCodeAt(0) - 'a'.charCodeAt(0) + 1 : sfx.length > 1 ? 99 : 0;
  return { date: new Date(y, mo - 1, d), revision };
}

function extractPdfUrls(html: string, base: string): string[] {
  const urls = new Set<string>();
  const pattern = /href="([^"]+\.pdf)"/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    if (!VIIKKOPELIT_RE.test(m[1])) continue;
    let url = m[1];
    if (url.startsWith('/')) url = 'https://ols.fi' + url;
    else if (!url.startsWith('http')) url = base.replace(/\/$/, '') + '/' + url;
    urls.add(url);
  }
  return [...urls];
}

async function fetchPageUrls(pageUrl: string, base: string): Promise<string[]> {
  try {
    const res = await fetch(pageUrl, { headers: HEADERS });
    if (!res.ok) return [];
    return extractPdfUrls(await res.text(), base);
  } catch {
    return [];
  }
}

async function scanDirectory(year: number, month: number): Promise<string[]> {
  const url = `${UPLOADS_BASE}/${year}/${String(month).padStart(2, '0')}/`;
  return fetchPageUrls(url, url);
}

function findLatest(urls: string[]): PdfInfo | null {
  let latest: PdfInfo | null = null;
  let latestRevision = -1;
  let fallback: PdfInfo | null = null;

  for (const url of urls) {
    const parsed = parsePdfUrlDate(url);
    const filename = url.split('/').pop()!.replace(/\.pdf$/i, '');
    const localPath = path.join(DATA_DIR, `${filename}.pdf`);

    if (!parsed) {
      if (!fallback) fallback = { url, localPath, date: new Date(0), hash: '' };
      continue;
    }

    const { date, revision } = parsed;
    const isNewer = !latest || date > latest.date || (date.getTime() === latest.date.getTime() && revision > latestRevision);
    if (isNewer) {
      latest = { url, localPath, date, hash: '' };
      latestRevision = revision;
    }
  }

  return latest ?? fallback;
}

async function downloadPdf(url: string, localPath: string): Promise<Buffer> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading PDF from ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buffer);
  console.log(`Downloaded: ${localPath}`);
  return buffer;
}

export async function fetchLatestPdf(): Promise<PdfInfo | null> {
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextY = mo === 12 ? y + 1 : y;

  // OLS page is primary (links the current week's PDF even with wild filenames)
  // Upload directories are secondary (catch PDFs not yet linked from the page)
  const [pageUrls, curUrls, nextUrls] = await Promise.all([
    fetchPageUrls(OLS_PAGE, 'https://ols.fi'),
    scanDirectory(y, mo),
    scanDirectory(nextY, nextMo),
  ]);
  const allUrls = [...new Set([...pageUrls, ...curUrls, ...nextUrls])];
  console.log(`Found ${allUrls.length} viikkopelit PDF URL(s):`, allUrls);

  const latest = findLatest(allUrls);
  if (!latest) {
    console.warn('No viikkopelit PDFs found in upload directories');
    return null;
  }

  console.log(`Latest: ${latest.url} (${latest.date.toLocaleDateString('fi-FI')})`);

  if (fs.existsSync(latest.localPath)) {
    const existingHash = sha256(fs.readFileSync(latest.localPath));
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
      console.log(`PDF unchanged (hash match)`);
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
