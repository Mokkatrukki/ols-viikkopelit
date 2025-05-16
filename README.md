# OLS Viikkopelit Viewer

This web application is designed to parse and display game schedules from the OLS Viikkopelit PDF files. It allows users to easily view upcoming matches, opponents, game times, and field locations.

## Project Goals

- Provide a user-friendly interface to view team schedules.
- Accurately extract game information from complex PDF layouts.
- Offer a clear overview of all games for a given PDF.

## Features

- **Clean User Interface**: Styled with Tailwind CSS for a modern and responsive look.
- **Team Schedule Display**: View game schedules by selecting a team.
- **Grouped Team Selection**: Teams in the dropdown are grouped by their league/season year (e.g., 2017, 2019) for easier navigation.
- **Dynamic Game Information**: Displays time, opponent, and field for each match.

## PDF Parsing

The core of this application is its PDF parsing capability, which transforms the visual layout of the game schedule PDF into structured data. This is a two-step process:

1.  **Initial PDF to JSON Conversion (`src/pdfParser.ts`)**:
    *   The `pdf2json` library is used to convert the input PDF file (e.g., `Viikkopelit_15_5_2025.pdf`) into a detailed JSON structure.
    *   This initial JSON output (`parsed_pdf_data.json`) contains all text elements along with their precise coordinates (x, y), font information, and page numbers. This level of detail is crucial for handling the PDF's column-based layout where raw text extraction would result in jumbled data.

2.  **Structured Data Extraction (`src/dataExtractor.ts`)**:
    *   This script takes the `parsed_pdf_data.json` as input.
    *   It processes the text elements, grouping them into lines and then identifying game blocks based on their spatial relationships.
    *   It extracts key game information such as time, teams, opponent, field, game duration, game type, and year (league/season).
    *   The final extracted game data is saved into `extracted_games_output.json` in a structured format, ready for use by the web application.

## Tech Stack

- **Backend**: Express.js with TypeScript
- **Frontend**: EJS (Embedded JavaScript templates) for server-side rendering.
- **Styling**: Tailwind CSS
- **PDF Parsing**: `pdf2json` (initial parsing), custom logic for data extraction (`src/dataExtractor.ts`).

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

3.  **Place the PDF and Generate Game Data:**
    *   Ensure the target PDF file (e.g., `Viikkopelit_15_5_2025.pdf`) is present in the root directory of the project, or update the path in `src/pdfParser.ts`.
    *   Run the PDF parsing process (this might need to be adapted based on your `package.json` scripts for `pdfParser.ts` and `dataExtractor.ts`):
        *   To generate intermediate `parsed_pdf_data.json` (if your `npm run dev` points to `pdfParser.ts` or similar):
            ```bash
            # Example: node --loader ts-node/esm src/pdfParser.ts 
            ```
        *   To extract structured game data into `extracted_games_output.json`:
            ```bash
            npm run extract 
            # or directly: node --loader ts-node/esm src/dataExtractor.ts
            ```
        This `extracted_games_output.json` is crucial for the application to run.

4.  **Build the project:**
    *   This compiles TypeScript and Tailwind CSS.
    ```bash
    npm run build
    ```

5.  **Start the application:**
    ```bash
    npm start # Runs the compiled JavaScript from dist/
    ```
    Alternatively, for development with auto-rebuild for TS and CSS:
    ```bash
    npm run dev 
    ```
    The application will be available at `http://localhost:3002` (or your configured port).

## Project Structure

```
.
├── Viikkopelit_15_5_2025.pdf  # Example input PDF
├── dist/                       # Compiled JavaScript and CSS files (ignored by Git)
├── node_modules/               # Project dependencies
├── public/
│   └── css/
│       └── style.css           # Output CSS from Tailwind
├── src/
│   ├── app.ts                  # Express application logic
│   ├── pdfParser.ts            # Script to convert PDF to structured JSON
│   ├── dataExtractor.ts        # Script to extract game data from JSON
│   └── input.css               # Tailwind CSS input file
├── views/
│   └── index.ejs              # EJS template for the main page
├── .gitignore                  # Specifies intentionally untracked files
├── package.json                # Project metadata and dependencies
├── package-lock.json           # Lockfile for dependencies
├── postcss.config.js           # PostCSS configuration (for Tailwind)
├── tailwind.config.js          # Tailwind CSS configuration
├── tsconfig.json               # TypeScript compiler options
├── plan.md                     # Initial project plan (may be outdated)
└── README.md                   # This file
``` 