# OLS Viikkopelit Viewer

This project consists of two web applications designed to parse, manage, and display game schedules from the OLS Viikkopelit PDF files.

1.  **OLS Viikkopelit Viewer (`ols-viikkopelit`)**: The main user-facing application that displays the game schedules. Users can easily view upcoming matches, opponents, game times, and field locations.
2.  **OLS Viikkopelit Admin (`ols-viikkopelit-admin`)**: A separate microservice responsible for web scraping the latest PDF, parsing it, extracting game data, and providing an API for the viewer app.

## Project Goals

- Provide a user-friendly interface to view team schedules (`ols-viikkopelit`).
- Reliably automate the process of fetching and parsing PDF game schedules (`ols-viikkopelit-admin`).
- Decouple data scraping/processing from the data presentation layer.
- Ensure persistent storage for scraped game data.
- Deploy both applications efficiently on Fly.io.

## Architecture Overview

The system is designed as a microservice architecture:

*   **`ols-viikkopelit` (Main Viewer App)**:
    *   Responsibilities: Displays game schedules, team information, and field maps to end-users.
    *   Data Source: Fetches structured game data from the `ols-viikkopelit-admin` app via an internal API call.
    *   Storage: Stores a local copy of the game data on its own persistent Fly.io volume (`ols_data`) for quick access.
    *   URL: [https://ols-viikkopelit.fly.dev/](https://ols-viikkopelit.fly.dev/)

*   **`ols-viikkopelit-admin` (Admin & Scraping App)**:
    *   Responsibilities: 
        *   Provides an admin dashboard to trigger data updates.
        *   Uses Puppeteer to scrape the latest Viikkopelit PDF from the OLS website.
        *   Parses the PDF using `pdf2json` and custom extraction logic.
        *   Saves the extracted structured game data (`extracted_games_output.json`) to its dedicated persistent Fly.io volume (`ols_admin_data`).
        *   Exposes a secure API endpoint for the main viewer app to fetch the latest game data.
    *   URL: [https://ols-viikkopelit-admin.fly.dev/](https://ols-viikkopelit-admin.fly.dev/)

**Data Flow:**
1. An administrator accesses the `ols-viikkopelit-admin` dashboard and triggers an update.
2. `ols-viikkopelit-admin` scrapes the PDF, processes it, and saves `extracted_games_output.json` to its volume.
3. An administrator accesses the `/admin` page on the main `ols-viikkopelit` app and triggers a data refresh.
4. The main `ols-viikkopelit` app calls a secure API endpoint on `ols-viikkopelit-admin` to get the latest `extracted_games_output.json`.
5. The main `ols-viikkopelit` app saves this data to its own volume and updates its display.

## Features (Main Viewer App - `ols-viikkopelit`)

- **Clean User Interface**: Styled with Tailwind CSS for a modern and responsive look.
- **Team Schedule Display**: View game schedules by selecting a team.
- **Grouped Team Selection**: Teams in the dropdown are grouped by their league/season year (e.g., 2017, 2019) for easier navigation.
- **Dynamic Game Information**: Displays time, opponent, and field for each match.
- **Admin Refresh**: Ability for an admin to trigger a refresh of game data from the admin service.

## PDF Parsing & Data Extraction (`ols-viikkopelit-admin`)

The PDF parsing and data extraction logic resides entirely within the `ols-viikkopelit-admin` application.

1.  **Web Scraping**: Puppeteer is used to navigate to `https://ols.fi/jalkapallo/viikkopelit/` and download the latest Viikkopelit PDF schedule.
2.  **PDF to Structured JSON (`pdfParser.ts` in admin app)**: The downloaded PDF is processed by `pdf2json` to convert its content and layout into a structured JSON file (`parsed_pdf_data.json`). This file includes text elements and their coordinates.
3.  **Data Extraction (`dataExtractor.ts` in admin app)**: Custom logic in this script reads `parsed_pdf_data.json`, identifies game blocks, headers, and extracts game details (time, teams, field, year/league). The final output is `extracted_games_output.json`.

This entire process is triggered from the `ols-viikkopelit-admin` dashboard and runs on its Fly.io instance, saving the output to its dedicated volume.

## Tech Stack

**`ols-viikkopelit` (Main Viewer App):**
- Backend: Express.js with TypeScript
- Frontend: EJS (Embedded JavaScript templates) for server-side rendering
- Styling: Tailwind CSS
- HTTP Client: `axios` (for fetching data from the admin app)

**`ols-viikkopelit-admin` (Admin & Scraping App):**
- Backend: Express.js with TypeScript
- Frontend (Admin Dashboard): EJS
- Styling: Tailwind CSS
- Web Scraping: Puppeteer (with Chromium)
- PDF Parsing: `pdf2json` and custom extraction logic

## Local Development Setup

This project contains two separate Node.js applications: the main viewer app (`ols-viikkopelit`) in the root directory, and the admin/scraping app (`ols-viikkopelit-admin`) in the `admin_app/` subdirectory.

**1. `ols-viikkopelit` (Main Viewer App - Root Directory)**

*   **Prerequisites:** Node.js, npm.
*   **Installation:**
    ```bash
    # Navigate to the project root
    cd /path/to/ols-viikkopelit
    npm install
    ```
*   **Data File:** This app requires `persistent_app_files/extracted_games_output.json` to display data. For local development, you can:
    *   Manually create this file with sample data.
    *   Or, run the `ols-viikkopelit-admin` app locally (see below) and then copy its generated `extracted_games_output.json` into the main app's `./persistent_app_files/` directory.
    *   Alternatively, for more integrated local development, you could modify the main app's environment to fetch from a locally running admin app instance (requires setting `ADMIN_APP_DATA_URL` and `API_ACCESS_KEY` locally, e.g., via a `.env` file and `dotenv` package).
*   **Build:**
    ```bash
    npm run build # Compiles TypeScript and Tailwind CSS
    ```
*   **Run:**
    ```bash
    npm start # Runs from dist/
    # OR for development with auto-rebuilds:
    npm run dev
    ```
    The viewer app will be available at `http://localhost:3002` (or as configured).

**2. `ols-viikkopelit-admin` (Admin & Scraping App - `admin_app/` Directory)**

*   **Prerequisites:** Node.js, npm. For Puppeteer, a local installation of Chromium is typically needed if not running via Docker.
*   **Installation:**
    ```bash
    # Navigate to the admin_app subdirectory
    cd /path/to/ols-viikkopelit/admin_app
    npm install
    ```
*   **Environment (Local):**
    *   This app uses `APP_PERSISTENT_STORAGE_PATH` to know where to save downloaded PDFs and generated JSON. Locally, it defaults to a path relative to its own `admin_app.ts` (e.g., `admin_app/persistent_app_files_admin/`). You might want to use a `.env` file with `dotenv` to manage this and `API_ACCESS_KEY` for local testing of its API.
*   **Build:**
    ```bash
    npm run build # Compiles TypeScript
    ```
*   **Run:**
    ```bash
    npm start # Runs from dist/
    # OR for development (if dev script configured):
    # npm run dev 
    ```
    The admin app will be available at `http://localhost:3003` (or as configured).
    *   You can then access its dashboard to trigger PDF scraping and processing. The output `extracted_games_output.json` will be in its configured persistent storage path.

## Project Structure (Simplified)

```
.
├── admin_app/                  # OLS Viikkopelit Admin microservice
│   ├── src/
│   │   ├── admin_app.ts        # Admin app Express logic
│   │   ├── updateLatestPdf.ts  # Puppeteer scraping logic
│   │   ├── pdfParser.ts        # PDF to JSON conversion
│   │   └── dataExtractor.ts    # Game data extraction from JSON
│   ├── views/
│   │   └── admin_dashboard.ejs # Admin dashboard template
│   ├── Dockerfile              # Dockerfile for admin_app (with Puppeteer)
│   ├── fly.toml                # Fly.io config for admin_app
│   ├── package.json
│   └── ...                     # Other admin_app files (tsconfig, tailwind config, etc.)
├── dist/                       # Compiled JS for main app (ols-viikkopelit)
├── node_modules/               # Dependencies for main app
├── persistent_app_files/       # Local storage for main app's extracted_games_output.json
├── public/
│   └── css/style.css           # Tailwind output for main app
├── src/
│   ├── app.ts                  # Express logic for main app (ols-viikkopelit)
│   └── input.css               # Tailwind input for main app
├── views/
│   ├── index.ejs               # Main page template for main app
│   └── ops-refresh-data.ejs    # Admin refresh page for main app
├── Dockerfile                  # Dockerfile for main app (ols-viikkopelit)
├── fly.toml                    # Fly.io config for main app
├── package.json                # Main app dependencies & scripts
├── tsconfig.json               # Main app TypeScript config
└── README.md                   # This file
``` 

## Data Update Process (Production)

The data update process involves interacting with both deployed applications:

1.  **Trigger Scraping & Parsing (`ols-viikkopelit-admin`):
    *   Navigate to the admin dashboard of the `ols-viikkopelit-admin` app: [https://ols-viikkopelit-admin.fly.dev/](https://ols-viikkopelit-admin.fly.dev/)
    *   Click the "Trigger Full Data Update" button.
    *   This initiates the Puppeteer script to scrape the latest PDF from the OLS website, parse it, extract game data, and save `extracted_games_output.json` to its dedicated volume (`ols_admin_data`) on Fly.io.
    *   Monitor the `ols-viikkopelit-admin` logs on Fly.io for progress and confirmation.

2.  **Refresh Data in Main Viewer App (`ols-viikkopelit`):
    *   Navigate to the admin page of the main `ols-viikkopelit` app: [https://ols-viikkopelit.fly.dev/admin](https://ols-viikkopelit.fly.dev/admin)
    *   Click the "Reload Data from Shared Storage" (or similarly named) button.
    *   This action triggers the main app to call the secure API of `ols-viikkopelit-admin`, fetch the latest `extracted_games_output.json`, save it to its own Fly.io volume (`ols_data`), and then reload the game data for display.
    *   Monitor the `ols-viikkopelit` logs on Fly.io for confirmation.

This two-step process ensures that the data scraping is handled by the specialized admin app, and the main app consumes this data in a controlled manner.

## Dockerization

Both applications are designed to be run as Docker containers.

*   **`ols-viikkopelit` (Main Viewer App - Root Directory):**
    *   Its `Dockerfile` (in the project root) sets up a simple Node.js 18 environment, installs dependencies, builds the TypeScript & Tailwind CSS, and runs the application. It does **not** include Puppeteer or Chromium, making the image significantly smaller.
    *   To build locally: `docker build -t ols-viikkopelit .`
    *   To run locally: `docker run -p 3002:3002 -v $(pwd)/persistent_app_files:/usr/src/app/persistent_app_files -e APP_PERSISTENT_STORAGE_PATH=/usr/src/app/persistent_app_files ols-viikkopelit` (This example mounts a local directory for data and sets the env var; adapt as needed for local testing).

*   **`ols-viikkopelit-admin` (Admin & Scraping App - `admin_app/` Directory):**
    *   Its `Dockerfile` (in `admin_app/`) is based on Node.js 18 but **includes** the installation of Chromium and necessary dependencies for Puppeteer to function correctly.
    *   It sets environment variables like `PUPPETEER_EXECUTABLE_PATH` to use the installed Chromium.
    *   To build locally: `cd admin_app && docker build -t ols-viikkopelit-admin . && cd ..`
    *   To run locally: `docker run -p 3003:3003 -v $(pwd)/admin_app/persistent_app_files_admin:/data/app_files -e APP_PERSISTENT_STORAGE_PATH=/data/app_files -e API_ACCESS_KEY=your_local_key ols-viikkopelit-admin` (Example, adjust port, volume mount, and env vars).

## Deployment to Fly.io

Both applications are deployed to Fly.io. Ensure you have `flyctl` installed and are logged in (`fly auth login`).

**1. `ols-viikkopelit` (Main Viewer App)**

*   **App Name on Fly.io**: `ols-viikkopelit` (or your chosen name)
*   **Location in Repository**: Project root (`/`)
*   **Configuration File**: `fly.toml` (in the project root)
*   **First-time Launch (if not already done for this app name):**
    ```bash
    # From the project root directory (/path/to/ols-viikkopelit)
    fly launch --name ols-viikkopelit --region arn 
    # Follow prompts. It should detect Dockerfile. Review fly.toml.
    ```
*   **Volume Creation (if not already done):**
    ```bash
    fly volumes create ols_data --region arn --size 1 --app ols-viikkopelit
    ```
*   **Secrets:**
    ```bash
    fly secrets set API_ACCESS_KEY="YOUR_SHARED_API_KEY" -a ols-viikkopelit
    fly secrets set ADMIN_APP_DATA_URL="https://ols-viikkopelit-admin.fly.dev/api/internal/latest-games-data" -a ols-viikkopelit
    ```
    (Replace `YOUR_SHARED_API_KEY` with the actual key, e.g., `VILLIKISSA_VIEKAIKKIEN_RUUAT2342`)
*   **Deployment:**
    ```bash
    # From the project root directory
    fly deploy
    ```

**2. `ols-viikkopelit-admin` (Admin & Scraping App)**

*   **App Name on Fly.io**: `ols-viikkopelit-admin` (or your chosen name)
*   **Location in Repository**: `admin_app/` subdirectory
*   **Configuration File**: `admin_app/fly.toml`
*   **First-time Launch (if not already done for this app name):**
    ```bash
    # From the admin_app directory (/path/to/ols-viikkopelit/admin_app)
    fly launch --name ols-viikkopelit-admin --region arn --no-deploy 
    # Follow prompts. It should detect admin_app/Dockerfile. Review admin_app/fly.toml.
    # --no-deploy is useful to set up volume and secrets before first deploy.
    ```
*   **Volume Creation (if not already done):**
    ```bash
    fly volumes create ols_admin_data --region arn --size 1 --app ols-viikkopelit-admin
    ```
*   **Secrets:**
    ```bash
    # For the API endpoint it serves
    fly secrets set API_ACCESS_KEY="YOUR_SHARED_API_KEY" -a ols-viikkopelit-admin 
    # Consider adding secrets to protect its dashboard, e.g., BASIC_AUTH_USERNAME, BASIC_AUTH_PASSWORD
    ```
*   **Deployment:**
    ```bash
    # From the admin_app directory
    cd admin_app
    fly deploy
    cd .. # Return to project root
    ```

**General Fly.io Notes:**
*   Both `fly.toml` files are configured for `auto_stop_machines = true` and `min_machines_running = 0` for cost-efficiency.
*   Health checks (`/health` endpoint) are configured for both apps.
*   Check logs with `fly logs -a <app-name>`.
*   Ensure the `[mounts]` section in each `fly.toml` correctly points to its respective volume name (`ols_data` or `ols_admin_data`) and mounts to `/data`.

## Persistent Data Storage with Fly.io Volumes

Both applications leverage Fly.io Volumes for persistent data storage, crucial for maintaining data across deployments and machine restarts.

*   **`ols-viikkopelit` (Main Viewer App):**
    *   **Volume Name:** `ols_data` (or as configured in its `fly.toml`)
    *   **Mount Point:** `/data` (as defined in its `fly.toml`)
    *   **Internal Path Usage:** The app's `APP_PERSISTENT_STORAGE_PATH` environment variable (set in its `Dockerfile`) is `/data/app_files`. It stores the fetched `extracted_games_output.json` here (e.g., at `/data/app_files/extracted_games_output.json`).

*   **`ols-viikkopelit-admin` (Admin & Scraping App):**
    *   **Volume Name:** `ols_admin_data` (or as configured in `admin_app/fly.toml`)
    *   **Mount Point:** `/data` (as defined in `admin_app/fly.toml`)
    *   **Internal Path Usage:** Similar to the main app, its `APP_PERSISTENT_STORAGE_PATH` is `/data/app_files`. It stores downloaded PDFs (e.g., in `/data/app_files/downloaded_pdfs/`), the intermediate `parsed_pdf_data.json`, and the final `extracted_games_output.json` in this directory structure on its volume.

This separation of volumes ensures that each app manages its own persistent data independently.

## Admin Page and Manual Updates

The application includes an admin interface:

- **Access**: Navigate to `/admin` on your deployed application URL (e.g., `https://your-app-name.fly.dev/admin`).
- **Features**:
    - Displays information about the currently loaded schedule (source PDF filename and document date).
    - Provides a "Check for New Schedule & Update" button.
- **Manual Update**: Clicking the button on the `/admin` page triggers the `runUpdater` function, which attempts to fetch and process the latest PDF from the OLS website. This is the same function that can be triggered by the scheduled task.

## Scheduling PDF Updates on Fly.io

To keep the game data automatically updated on Fly.io without manual intervention:

1.  **HTTP Endpoint for Updates**:
    The application exposes a POST endpoint at `/trigger-pdf-update` (in `src/app.ts`). This endpoint calls the `runUpdater` function from `src/updateLatestPdf.ts`.
    ```typescript
    // Snippet from src/app.ts
    app.post('/trigger-pdf-update', async (req, res) => {
        // Optional: Add a secret token check for security (recommended for public-facing apps)
        // const expectedToken = process.env.UPDATE_SECRET_TOKEN;
        // const providedToken = req.headers['x-update-token'];
        // if (!expectedToken || providedToken !== expectedToken) {
        //   return res.status(401).send('Unauthorized: Invalid or missing token.');
        // }

        console.log('PDF update triggered via HTTP endpoint.');
        try {
            await runUpdater(); // This function now uses APP_PERSISTENT_STORAGE_PATH
            // Reload game data after update
            gameData = loadGameData(); 
            console.log('Game data reloaded after update.');
            res.status(200).send('PDF update process successfully initiated and data reloaded.');
        } catch (error) {
            console.error('Error during HTTP-triggered PDF update:', error);
            res.status(500).send('Failed to initiate PDF update.');
        }
    });
    ```
    *   **Security Note**: For a publicly accessible endpoint, consider adding a secret token shared between your scheduler and the app to prevent unauthorized triggers. The example above includes a commented-out suggestion.

2.  **Use an External Scheduler**:
    Configure an external cron job service to send a POST request to your deployed app's endpoint periodically (e.g., once a day).
    - **URL**: `https://your-app-name.fly.dev/trigger-pdf-update`
    - **Method**: POST
    - **Services**:
        - GitHub Actions scheduled workflow (if your project is on GitHub)
        - [EasyCron](https://www.easycron.com/)
        - [cron-job.org](https://cron-job.org/)
        - [Pipedream](https://pipedream.com/)
        - Or any other service that can send scheduled HTTP requests.

This approach works well with Fly.io's architecture, especially if `min_machines_running = 0` is set, as Fly.io will start a machine to handle the request and then stop it after a period of inactivity.
The `/admin` page also provides a manual way to trigger this update process. 