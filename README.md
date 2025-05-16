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

## Automated PDF Schedule Updates

This project includes a script to automatically fetch the latest Viikkopelit game schedule PDF from the OLS website, process it, and update the `extracted_games_output.json` file used by the application.

- **Script**: `src/updateLatestPdf.ts`
- **How it works**: Uses Puppeteer to navigate to `https://ols.fi/jalkapallo/viikkopelit/`, identifies the most relevant PDF link (based on dates in filenames, prioritizing upcoming or recent games), downloads the PDF to the project root, and then runs the `npm run process-pdf -- <downloaded_pdf_filename>.pdf` command.
- **To run manually**: 
  ```bash
  npm run update-schedule
  ```

## Dockerization

The application can be built and run as a Docker container. A `Dockerfile` is provided, which sets up Node.js, installs all dependencies (including those for Puppeteer/Chromium), builds the project, and configures it to run.

**Key Dockerfile features**:
- Based on `node:18-slim`.
- Installs `chromium` and necessary libraries for Puppeteer.
- Sets `PUPPETEER_EXECUTABLE_PATH` and `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` so Puppeteer uses the system-installed Chromium.
- Runs `npm ci` for dependency installation and `npm run build`.
- Exposes port `3002` and starts the application with `npm start`.

**Build the Docker image**:
```bash
npm install # Ensure local puppeteer types are available for local dev if needed
docker build -t ols-viikkopelit-viewer .
```

**Run the Docker container**:
```bash
docker run -p 3002:3002 -d ols-viikkopelit-viewer
```
Access the application at `http://localhost:3002`.

## Deployment to Fly.io

This application is suitable for deployment on [Fly.io](https://fly.io/).

1.  **Install `flyctl`**: Follow the instructions on the Fly.io website.
2.  **Login to Fly.io**: `fly auth login`
3.  **Launch the app** (first time only):
    ```bash
    fly launch --name your-app-name --region your-preferred-region
    ```
    Replace `your-app-name` (e.g., `ols-viikkopelit`) and `your-preferred-region` (e.g., `arn` for Stockholm, `hel` for Helsinki).
    This will detect the `Dockerfile`, create a `fly.toml` configuration file, and may ask you to choose an organization. Review the `fly.toml` settings.
    *   **Important**: Ensure your `fly.toml` has `internal_port = 3002` (or your app's configured port) under `[http_service]`.
    *   Consider setting `auto_stop_machines = 'stop'`, `auto_start_machines = true`, and `min_machines_running = 0` in `[http_service]` for cost-effective scaling to zero.
    *   You can adjust machine resources (e.g., `memory = '256mb'`) under the `[[vm]]` section.

4.  **Provision a Fly Volume** (for persistent storage, see section below for details):
    Before the first deploy, or if you haven't already, create a volume:
    ```bash
    fly volumes create ols_data --region your-preferred-region --size 1 --app your-app-name
    ```
    (Replace `ols_data` if you prefer a different volume name, and update `fly.toml` accordingly).

5.  **Configure `fly.toml` for the Volume**:
    Ensure your `fly.toml` has a `[mounts]` section like this (matching your volume name):
    ```toml
    [mounts]
      source = "ols_data"
      destination = "/data"
    ```

6.  **Deploy**:
    ```bash
    fly deploy
    ```
    This command builds your Docker image (or uses one from a registry if configured) and deploys it to Fly.io.

7.  **Scaling and Machine Management**:
    *   If you encounter issues related to volume attachments (e.g., "volume is attached to another machine"), you might need to scale your app to one machine if it was launched with more:
        ```bash
        fly scale count app=1 --app your-app-name
        ```
    *   You can list your volumes: `fly volumes list --app your-app-name`
    *   You can access your machine's console: `fly ssh console --app your-app-name`

## Persistent Data Storage with Fly.io Volumes

By default, files created by the application inside the Docker container (like downloaded PDFs and generated JSON data) are lost when the container restarts or is redeployed. To make this data persistent on Fly.io, you need to use Fly Volumes.

1.  **Environment Variable for Storage Path**:
    *   The application uses the `APP_PERSISTENT_STORAGE_PATH` environment variable to determine where to store and read persistent files (downloaded PDFs, `parsed_pdf_data.json`, `extracted_games_output.json`).
    *   If this variable is not set (e.g., during local development), it defaults to `./persistent_app_files/` in your project root.
    *   In the `Dockerfile`, this is set to `/data/app_files`. This path is within the volume when mounted.

2.  **Provision a Fly Volume**:
    Create a volume for your application (if not done during initial launch steps). This volume will persist data across deployments and machine restarts.
    ```bash
    fly volumes create <your_volume_name> --region <your_region> --size <size_gb> --app <your_app_name>
    ```
    For example:
    ```bash
    fly volumes create ols_data --region arn --size 1 --app ols-viikkopelit
    ```
    It's recommended to use the same region as your application. A 1GB volume is usually sufficient for this application.

3.  **Configure `fly.toml` to Mount the Volume**:
    Edit your `fly.toml` file to mount the created volume to the `/data` path inside your container. Add or verify the `[mounts]` section:
    ```toml
    # fly.toml
    app = "your-ols-app-name" # e.g., ols-viikkopelit
    # ... other configurations ...

    [mounts]
      source = "ols_data"          # Name of the volume you created
      destination = "/data"         # Path inside the container where the volume will be available
                                    # The app expects its files in /data/app_files/ on this volume
    ```

4.  **Deploy**: After configuring `fly.toml`, deploy your application:
    ```bash
    fly deploy
    ```
    Fly.io will attempt to attach the volume to a new machine. If a machine already exists, it might need to be replaced, or you might need to ensure only one machine is running for the volume to attach correctly (`fly scale count app=1`).

5.  **Seeding Initial Data (e.g., `extracted_games_output.json`)**:
    If you have a pre-existing `extracted_games_output.json` (or other necessary files) locally that you want to use as a starting point on the volume:
    *   First, ensure the application has run at least once on Fly.io or manually create the target directory structure if needed. The scripts are designed to create `downloaded_pdfs` and `app_files` inside `/data/` if they don't exist.
    *   Use `fly sftp shell` to upload files:
        ```bash
        fly sftp shell --app your-app-name
        ```
    *   Inside the SFTP shell:
        ```sftp
        # Navigate to the directory where the app stores its persistent files
        cd /data/app_files

        # Upload your local file to the current directory on the volume
        # Assuming your local file is in ./persistent_app_files/extracted_games_output.json
        put ./persistent_app_files/extracted_games_output.json extracted_games_output.json

        # You can also upload other files, like a specific PDF to downloaded_pdfs
        # cd ../downloaded_pdfs
        # put ./local_pdfs/some_initial.pdf some_initial.pdf

        exit
        ```
    *   After seeding data, you might need to restart your application for it to pick up the new files: `fly apps restart your-app-name` or trigger a new deployment.

Now, when your application runs the update process:
- PDFs will be downloaded to `/data/app_files/downloaded_pdfs/` on the volume.
- `parsed_pdf_data.json` will be at `/data/app_files/parsed_pdf_data.json` on the volume.
- `extracted_games_output.json` will be at `/data/app_files/extracted_games_output.json` on the volume, and the application will read from this persistent location.

This ensures that your schedule data survives container restarts and deployments.

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