# OLS Viikkopelit Viewer

This web application is designed to parse and display game schedules from the OLS Viikkopelit PDF files. It allows users to easily view upcoming matches, opponents, game times, and field locations.

## Project Goals

- Provide a user-friendly interface to view team schedules.
- Accurately extract game information from complex PDF layouts.
- Offer a clear overview of all games for a given PDF.

## PDF Parsing

The core of this application is its PDF parsing capability, which transforms the visual layout of the game schedule PDF into structured data. This is a two-step process:

1.  **Initial PDF to JSON Conversion (`src/pdfParser.ts`)**:
    *   The `pdf2json` library is used to convert the input PDF file (e.g., `Viikkopelit_15_5_2025.pdf`) into a detailed JSON structure.
    *   This initial JSON output (`parsed_pdf_data.json`) contains all text elements along with their precise coordinates (x, y), font information, and page numbers. This level of detail is crucial for handling the PDF's column-based layout where raw text extraction would result in jumbled data.

2.  **Structured Data Extraction (`src/dataExtractor.ts`)**:
    *   This script takes the `parsed_pdf_data.json` as input.
    *   It processes the text elements, grouping them into lines and then identifying game blocks based on their spatial relationships.
    *   It extracts key game information such as time, teams, opponent, field, game duration, game type, and year.
    *   The final extracted game data is saved into `extracted_games_output.json` in a structured format, ready for use by the web application.

## Tech Stack (Planned)

- **Backend**: Express.js with TypeScript
- **Frontend**: Server-side rendered HTML (e.g., using EJS or Pug)
- **Styling**: Tailwind CSS
- **PDF Parsing**: `pdf2json` (initial parsing), custom logic for data extraction.

## Setup and Usage

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd ols-viikkopelit
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Place the PDF:**
    *   Ensure the target PDF file (e.g., `Viikkopelit_15_5_2025.pdf`) is present in the root directory of the project, or update the path in `src/pdfParser.ts`.

4.  **Run the PDF parsing process:**
    *   To generate `parsed_pdf_data.json` from the PDF:
        ```bash
        npm run dev # This script currently points to pdfParser.ts
        ```
    *   To extract structured game data from `parsed_pdf_data.json` (you might need to update the `dev` script in `package.json` to point to `dataExtractor.ts` or create a new script):
        ```bash
        # Assuming dev script is updated or a new script is made for dataExtractor.ts
        node --loader ts-node/esm src/dataExtractor.ts 
        ```
        This will produce `extracted_games_output.json`.

5.  **Build the project (for TypeScript compilation):**
    ```bash
    npm run build
    ```

6.  **Start the application (once the Express server is implemented):**
    ```bash
    npm start
    ```

## Project Structure

```
.
├── Viikkopelit_15_5_2025.pdf  # Example input PDF
├── dist/                       # Compiled JavaScript files
├── node_modules/               # Project dependencies
├── src/                        # TypeScript source files
│   ├── pdfParser.ts            # Script to convert PDF to structured JSON
│   └── dataExtractor.ts        # Script to extract game data from JSON
├── package.json                # Project metadata and dependencies
├── package-lock.json           # Lockfile for dependencies
├── tsconfig.json               # TypeScript compiler options
├── plan.md                     # Initial project plan
└── README.md                   # This file
``` 