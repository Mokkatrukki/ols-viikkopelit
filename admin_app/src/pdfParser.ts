import fs from 'fs';
import PDFParser from 'pdf2json';
import { exec } from 'child_process';
import path from 'path';

// Get PDF filename from command line arguments
const pdfFileNameArg = process.argv[2];

if (!pdfFileNameArg) {
  console.error('Error: PDF filename not provided.');
  console.log('Usage: npm run process-pdf -- <filename.pdf>');
  process.exit(1); // Exit with an error code
}

// const pdfFilePath = `./${pdfFileNameArg}`; // Prepend './' to look in the current directory
const pdfFilePath = path.isAbsolute(pdfFileNameArg) ? pdfFileNameArg : `./${pdfFileNameArg}`;

const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';
const outputJsonFilePath = path.join(PERSISTENT_STORAGE_BASE_PATH, 'parsed_pdf_data.json');

// Function to ensure directory for outputJsonFilePath exists
async function ensureOutputDirectoryExists() {
    const dir = path.dirname(outputJsonFilePath);
    try {
        await fs.promises.mkdir(dir, { recursive: true });
        console.log(`Directory ensured for output JSON: ${dir}`);
    } catch (error) {
        console.error(`Error creating directory ${dir} for output JSON:`, error);
        throw error; 
    }
}

// Create PDF parser with proper configuration based on pdf2json documentation
// @ts-ignore - The second parameter should be verbosity level according to docs
const pdfParser = new PDFParser(null, 1); // Second parameter is verbosity level

// Configure additional options
pdfParser.on('readable', meta => {
  console.log('PDF Metadata:', meta);
  // Check if the PDF is in landscape orientation
  const isLandscape = meta && meta.Width && meta.Height && meta.Width > meta.Height;
  console.log(`PDF orientation detected: ${isLandscape ? 'Landscape' : 'Portrait'}`);
});

// We won't override loadPDF since it's causing TypeScript errors
// Instead, we'll use the configuration options available in the library

// Set additional options if available in this version of pdf2json
try {
  // @ts-ignore - These properties might not be in the type definitions
  if (typeof pdfParser.configurationOption === 'object') {
    // @ts-ignore - Using documented options
    pdfParser.configurationOption = {
      detectOrientation: true,       // Enable orientation detection
      verbosity: 1,                 // Detailed logs but not too verbose
      disableCombineTextItems: false // Preserve text positioning
    };
    console.log('PDF parser configuration set successfully');
  }
} catch (error) {
  console.warn('Could not set PDF parser configuration options:', error);
}

pdfParser.on('pdfParser_dataError', (errData: any) => {
  console.error(`Error parsing PDF: ${pdfFilePath}`);
  console.error(errData.parserError);
});

// The pdfData argument here contains the full structured data
pdfParser.on('pdfParser_dataReady', async (pdfData: any) => {
  console.log(`PDF parsed successfully: ${pdfFilePath}`);
  try {
    await ensureOutputDirectoryExists(); // Ensure directory before writing

    // Add the source PDF filename to the data before stringifying
    const dataToWrite = {
        sourcePdfFile: pdfFileNameArg, // The original argument, which could be relative or absolute
        ...pdfData
    };
    const jsonString = JSON.stringify(dataToWrite, null, 2); // Pretty print JSON
    fs.writeFile(outputJsonFilePath, jsonString, (err: Error | null) => {
      if (err) {
        console.error(`Error writing JSON data to file: ${outputJsonFilePath}`, err);
      } else {
        console.log(`Structured PDF data saved to ${outputJsonFilePath}`);
        // Now, run the dataExtractor.ts script
        const extractCommand = 'node --loader ts-node/esm src/dataExtractor.ts';
        console.log(`Executing: ${extractCommand}`);
        exec(extractCommand, (error, stdout, stderr) => {
          if (error) {
            console.error(`Error executing dataExtractor.ts: ${error.message}`);
            return;
          }
          if (stderr) {
            console.error(`dataExtractor.ts stderr: ${stderr}`);
            // Potentially return here if stderr indicates a critical error,
            // or just log it and assume stdout will confirm success/failure.
          }
          console.log(`dataExtractor.ts stdout: ${stdout}`);
          console.log('Data extraction completed.');
        });
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
  console.log('Make sure the filename passed as an argument is correct and the file is in the root directory.');
  process.exit(1); // Exit with an error code if file not found
} 