import fs from 'fs';
import PDFParser from 'pdf2json';
import { exec } from 'child_process';
import path from 'path';

// Debug utility function
function debugLog(message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[DEBUG ${timestamp}] ${message}`;
  
  console.log(logMessage);
  if (data !== undefined) {
    if (typeof data === 'object') {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(data);
    }
  }
}

// Get PDF filename from command line arguments
const pdfFileNameArg = process.argv[2];

if (!pdfFileNameArg) {
  console.error('Error: PDF filename not provided.');
  console.log('Usage: npm run process-pdf -- <filename.pdf>');
  process.exit(1); // Exit with an error code
}

// const pdfFilePath = `./${pdfFileNameArg}`; // Prepend './' to look in the current directory
const pdfFilePath = path.isAbsolute(pdfFileNameArg) ? pdfFileNameArg : `./${pdfFileNameArg}`;

const PERSISTENT_STORAGE_BASE_PATH = process.env.APP_FILE_STORAGE_PATH || process.env.APP_PERSISTENT_STORAGE_PATH || './persistent_app_files';
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
  debugLog('PDF Metadata:', meta);
  
  // Check if the PDF is in landscape orientation
  const isLandscape = meta && meta.Width && meta.Height && meta.Width > meta.Height;
  debugLog(`PDF orientation detected: ${isLandscape ? 'Landscape' : 'Portrait'}`);
  
  // Log additional metadata that might be useful
  if (meta) {
    debugLog('PDF Dimensions', { Width: meta.Width, Height: meta.Height });
    debugLog('PDF Page Count', Array.isArray(meta.Pages) ? meta.Pages.length : 'Unknown');
  }
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
  
  // Additional debug info for errors
  debugLog('PDF Parser Error Details', {
    errorType: errData.parserError ? errData.parserError.name : 'Unknown',
    message: errData.parserError ? errData.parserError.message : 'No message',
    stack: errData.parserError ? errData.parserError.stack : 'No stack trace'
  });
});

// The pdfData argument here contains the full structured data
pdfParser.on('pdfParser_dataReady', async (pdfData: any) => {
  debugLog(`PDF parsed successfully: ${pdfFilePath}`);
  
  try {
    await ensureOutputDirectoryExists(); // Ensure directory before writing
    
    // Debug the PDF structure
    debugLog(`PDF Structure Overview:`, {
      pageCount: pdfData.Pages ? pdfData.Pages.length : 'Unknown',
      metaInfo: pdfData.Meta ? 'Present' : 'Missing'
    });
    
    // Search for GARAM MASALA 1B in the PDF data
    let garamMasala1BFound = false;
    let garamMasala1BElements = [];
    
    // Iterate through pages
    if (pdfData.Pages && Array.isArray(pdfData.Pages)) {
      debugLog(`Analyzing ${pdfData.Pages.length} pages for GARAM MASALA 1B references`);
      
      pdfData.Pages.forEach((page: any, pageIndex: number) => {
        if (page.Texts && Array.isArray(page.Texts)) {
          debugLog(`Page ${pageIndex + 1} has ${page.Texts.length} text elements`);
          
          // Search for GARAM MASALA 1B in text elements
          const masalaElements = page.Texts.filter((text: any) => {
            if (text.R && Array.isArray(text.R)) {
              return text.R.some((run: any) => {
                if (run.T) {
                  try {
                    const decodedText = decodeURIComponent(run.T);
                    return decodedText.includes('GARAM MASALA 1B');
                  } catch (e) {
                    return false;
                  }
                }
                return false;
              });
            }
            return false;
          });
          
          if (masalaElements.length > 0) {
            garamMasala1BFound = true;
            garamMasala1BElements.push(...masalaElements);
            
            debugLog(`Found ${masalaElements.length} GARAM MASALA 1B elements on page ${pageIndex + 1}`, masalaElements);
            
            // Look for nearby elements that might be related (teams, times)
            const pageWidth = page.Width || 100;
            const midPoint = pageWidth / 2;
            
            masalaElements.forEach((masalaElement: any) => {
              const masalaY = masalaElement.y;
              const masalaX = masalaElement.x;
              
              // Find elements that might be related (within a certain Y distance)
              const nearbyElements = page.Texts.filter((text: any) => {
                // Different Y position but not too far
                const yDiff = Math.abs(text.y - masalaY);
                return yDiff > 0 && yDiff < 5; // Adjust this threshold as needed
              });
              
              if (nearbyElements.length > 0) {
                debugLog(`Found ${nearbyElements.length} elements near GARAM MASALA 1B at y=${masalaY}`, 
                  nearbyElements.map((el: any) => ({
                    x: el.x,
                    y: el.y,
                    text: el.R && el.R[0] ? decodeURIComponent(el.R[0].T) : 'Unknown'
                  }))
                );
              }
            });
          }
        }
      });
    }
    
    if (!garamMasala1BFound) {
      debugLog('WARNING: No GARAM MASALA 1B references found in the PDF!');
    } else {
      debugLog(`Found ${garamMasala1BElements.length} total GARAM MASALA 1B elements in the PDF`);
    }
    
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
        debugLog(`Structured PDF data saved to ${outputJsonFilePath}`);
        // Now, run the dataExtractor.ts script
        const extractCommand = 'node --loader ts-node/esm src/dataExtractor.ts';
        debugLog(`Executing: ${extractCommand}`);
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
          debugLog(`dataExtractor.ts stdout: ${stdout}`);
          debugLog('Data extraction completed.');
        });
      }
    });
  } catch (e) {
    console.error('Error in pdfParser_dataReady while processing JSON:', e);
    debugLog('Exception in pdfParser_dataReady', {
      errorType: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : 'No stack trace'
    });
  }
});

debugLog(`Loading PDF from: ${pdfFilePath}`);
// Check if PDF file exists before attempting to load
if (fs.existsSync(pdfFilePath)) {
  debugLog(`PDF file exists, starting parsing process`);
  pdfParser.loadPDF(pdfFilePath);
} else {
  console.error(`PDF file not found at: ${pdfFilePath}. Please ensure the file exists in the project root.`);
  debugLog(`PDF file not found: ${pdfFilePath}`, {
    absolutePath: path.resolve(pdfFilePath),
    currentDirectory: process.cwd(),
    fileExists: false
  });
  console.log('Make sure the filename passed as an argument is correct and the file is in the root directory.');
  process.exit(1); // Exit with an error code if file not found
} 