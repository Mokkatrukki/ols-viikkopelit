import * as fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const data = new Uint8Array(fs.readFileSync('./Talviliiga221125a.pdf'));
const loadingTask = pdfjsLib.getDocument({ data });
const pdfDocument = await loadingTask.promise;

let fullText = '';
for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
  const page = await pdfDocument.getPage(pageNum);
  const textContent = await page.getTextContent();
  const pageText = textContent.items.map((item) => item.str).join(' ');
  fullText += pageText + '\n';
}

console.log(fullText);
