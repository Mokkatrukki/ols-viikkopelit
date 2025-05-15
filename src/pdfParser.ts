import fs from 'fs';
import PDFParser from 'pdf2json';

// The path to the PDF file, assuming it's in the project root
const pdfFilePath = './Viikkopelit_15_5_2025.pdf';
const outputJsonFilePath = './parsed_pdf_data.json'; // New output file

// Use default constructor for full JSON output
const pdfParser = new PDFParser(); 

pdfParser.on('pdfParser_dataError', (errData: any) => {
  console.error(`Error parsing PDF: ${pdfFilePath}`);
  console.error(errData.parserError);
});

// The pdfData argument here contains the full structured data
pdfParser.on('pdfParser_dataReady', (pdfData: any) => { 
  console.log(`PDF parsed successfully: ${pdfFilePath}`);
  try {
    const jsonString = JSON.stringify(pdfData, null, 2); // Pretty print JSON
    fs.writeFile(outputJsonFilePath, jsonString, (err: Error | null) => {
      if (err) {
        console.error(`Error writing JSON data to file: ${outputJsonFilePath}`, err);
      } else {
        console.log(`Structured PDF data saved to ${outputJsonFilePath}`);
      }
    });
  } catch (e) {
    console.error('Error in pdfParser_dataReady while processing JSON:', e);
  }
});

console.log(`Loading PDF from: ${pdfFilePath}`);
// Check if PDF file exists before attempting to load
if (fs.existsSync(pdfFilePath)) {
  pdfParser.loadPDF(pdfFilePath);
} else {
  console.error(`PDF file not found at: ${pdfFilePath}. Please ensure the file exists in the project root.`);
} 