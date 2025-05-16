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

The core of this application is its PDF parsing capability, which transforms the visual layout of the game schedule PDF into structured data. This process is now streamlined:

1.  **PDF to Structured Data (`src/pdfParser.ts` and `src/dataExtractor.ts` working together)**:
    *   The `pdf2json` library is used for initial conversion of the input PDF file into a detailed JSON structure (`parsed_pdf_data.json`). This contains all text elements with their precise coordinates, crucial for handling column-based layouts.
    *   The `src/dataExtractor.ts` script then processes this intermediate JSON to identify game blocks and extract key game information (time, teams, opponent, field, etc.).
    *   These two steps are now orchestrated by a single command (see "Setup and Usage"). The final extracted game data is saved into `extracted_games_output.json`, ready for the web application.

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

3.  **Generate Game Data from PDF:**
    *   Place your Viikkopelit PDF file (e.g., `Viikkopelit_8_5_2025.pdf`) in the root directory of the project.
    *   Run the PDF processing script, providing the name of your PDF file as an argument:
        ```bash
        npm run process-pdf -- your_pdf_filename.pdf
        ```
        For example:
        ```bash
        npm run process-pdf -- Viikkopelit_8_5_2025.pdf
        ```
    *   This command will:
        1.  Invoke `src/pdfParser.ts` with your specified PDF.
        2.  Generate an intermediate `parsed_pdf_data.json`.
        3.  Automatically trigger `src/dataExtractor.ts` to process the intermediate JSON.
        4.  Produce the final `extracted_games_output.json` required by the application.

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