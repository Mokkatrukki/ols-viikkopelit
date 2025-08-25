# OLS Viikkopelit Application - Complete Workflow Summary

## Overview

The OLS Viikkopelit system is a **microservice architecture** consisting of two separate Node.js applications that work together to automatically scrape, parse, and display Finnish football game schedules from PDF files published by OLS (Oulun Luistinseura).

### Key Achievement Metrics
- ⚡ **Performance**: 78ms startup (99.5%+ improvement from 15+ seconds)
- 💰 **Cost**: $0.39/month (83% reduction from $6.07/month)
- 🛡️ **Security**: Zero vulnerabilities (Node 22 Alpine)
- 📦 **Size**: 59MB compressed Docker image (91% smaller than legacy 1.64GB)

## Architecture Components

### 1. **Main Viewer App (`ols-viikkopelit`)**
- **Location**: Root directory
- **Purpose**: User-facing web application for viewing game schedules
- **URL**: https://ols-viikkopelit.fly.dev/
- **Port**: 3002 (local development)

### 2. **Admin/Scraping App (`ols-viikkopelit-admin`)**
- **Location**: `admin_app/` subdirectory
- **Purpose**: Data scraping, PDF parsing, and admin management
- **URL**: https://ols-viikkopelit-admin.fly.dev/
- **Port**: 3003 (local development)

---

## Complete Data Flow Process

### Phase 1: Data Scraping & Processing (Admin App)

#### Step 1: Trigger Data Update
- **Who**: Administrator
- **Where**: Admin dashboard at `https://ols-viikkopelit-admin.fly.dev/`
- **Action**: Click "Trigger Full Data Update" button
- **File**: `admin_app/src/admin_app.ts` (Express route handler)

#### Step 2: Web Scraping
- **Module**: `admin_app/src/updateLatestPdf.ts`
- **Technology**: Puppeteer with Chromium
- **Target**: `https://ols.fi/jalkapallo/viikkopelit/`
- **Process**:
  1. Launch headless browser
  2. Navigate to OLS website
  3. Locate latest Viikkopelit PDF link
  4. Download PDF file
  5. Save to persistent storage: `/data/app_files/downloaded_pdfs/`
- **Output**: Raw PDF file (e.g., `Viikkopelit_15_5_2025.pdf`)

#### Step 3: PDF Parsing
- **Module**: `admin_app/src/pdfParser.ts`
- **Technology**: `pdf2json` library
- **Process**:
  1. Read downloaded PDF file
  2. Convert PDF content to structured JSON
  3. Extract text elements with coordinates
  4. Preserve layout information
- **Output**: `parsed_pdf_data.json` (structured JSON with text positions)

#### Step 4: Data Extraction
- **Primary Module**: `admin_app/src/dataExtractor.ts`
- **Supporting Modules**: 
  - `admin_app/src/gameDataExtractor.ts` (specific extraction logic)
  - `admin_app/src/pageParserUtils.ts` (utility functions)
- **Process**:
  1. Read `parsed_pdf_data.json`
  2. Identify game blocks using coordinate analysis
  3. Parse headers (team names, year/league information)
  4. Extract individual game details:
     - Game time and date
     - Team names (home vs away)
     - Field/venue information
     - League/season year
  5. Structure data into organized format
- **Output**: `extracted_games_output.json` (final structured game data)

#### Step 5: Summary Generation (Optional)
- **Module**: `admin_app/src/generateGamesSummary.ts`
- **Process**: Generate human-readable summary from extracted data
- **Output**: `games_summary.txt`

### Phase 2: Data Distribution (Admin App API)

#### Step 6: API Endpoint Exposure
- **Module**: `admin_app/src/admin_app.ts`
- **Endpoint**: `/api/internal/latest-games-data`
- **Security**: Protected by `API_ACCESS_KEY`
- **Function**: Serves `extracted_games_output.json` to authorized clients

### Phase 3: Data Consumption (Main Viewer App)

#### Step 7: Trigger Data Refresh
- **Who**: Administrator
- **Where**: Main app admin page at `https://ols-viikkopelit.fly.dev/admin`
- **Action**: Click "Reload Data from Shared Storage" button
- **File**: `src/app.ts` (Express route handler)

#### Step 8: Data Fetching
- **Module**: `src/app.ts`
- **Technology**: Axios HTTP client
- **Process**:
  1. Make authenticated API call to admin app
  2. Request URL: `https://ols-viikkopelit-admin.fly.dev/api/internal/latest-games-data`
  3. Include `API_ACCESS_KEY` in headers
  4. Download `extracted_games_output.json`
  5. Save to local persistent storage: `/data/app_files/extracted_games_output.json`

#### Step 9: Data Loading & Display
- **Module**: `src/app.ts`
- **Process**:
  1. Reload game data from local file
  2. Parse and structure for display
  3. Group teams by league/season year
  4. Update in-memory data structures
- **Frontend**: `views/index.ejs` template
- **Features**:
  - Team dropdown with year grouping
  - Game schedule display
  - Field information with maps
  - Responsive design with Tailwind CSS

---

## Technical Implementation Details

### Backend Technologies
- **Runtime**: Node.js 22 Alpine (LTS, zero vulnerabilities)
- **Framework**: Express.js with TypeScript
- **Template Engine**: EJS (Embedded JavaScript)
- **Styling**: Tailwind CSS with critical CSS inlining
- **HTTP Client**: Axios
- **Web Scraping**: Puppeteer with Chromium (admin app only)
- **PDF Parsing**: pdf2json library (admin app only)

### Infrastructure & Deployment

#### Docker Optimization
- **Multi-stage builds** for minimal production images
- **Node 22 Alpine** base image (security & size)
- **Non-root user** for security
- **Health checks** using Node's built-in fetch API
- **Production dependency pruning**

#### Fly.io Configuration
- **Cost-optimized**: 256MB RAM, shared-cpu-1x
- **Sleep mode**: 5-minute timeout (90% cost savings)
- **Persistent volumes**:
  - Main app: `ols_data` volume mounted at `/data`
  - Admin app: `ols_admin_data` volume mounted at `/data`
- **Auto-scaling**: `min_machines_running = 0`

### Security Implementation
- **API authentication** between services
- **Environment variables** for sensitive data
- **Non-root container execution**
- **Zero security vulnerabilities** (Node 22 LTS)
- **Proper signal handling** with Docker init

### Performance Optimizations
- **Async data loading** (non-blocking startup)
- **Critical CSS inlining** (instant rendering)
- **Compressed Docker images** (59MB vs 1.64GB legacy)
- **Optimized health checks** (reduced overhead)
- **Sleep mode** for cost efficiency

---

## File Structure & Key Components

### Main Viewer App (`ols-viikkopelit`)
```
├── src/
│   ├── app.ts              # Main Express server logic
│   └── input.css           # Tailwind CSS input
├── views/
│   ├── index.ejs           # Main game display page
│   ├── admin.ejs           # Admin refresh interface
│   └── ops-refresh-data.ejs # Data refresh status page
├── public/
│   ├── css/style.css       # Compiled Tailwind CSS
│   └── images/             # Field maps and responsive images
├── persistent_app_files/
│   └── extracted_games_output.json # Local game data cache
├── Dockerfile              # Optimized container build
└── fly.toml               # Fly.io deployment config
```

### Admin/Scraping App (`ols-viikkopelit-admin`)
```
admin_app/
├── src/
│   ├── admin_app.ts        # Express server & API endpoints
│   ├── updateLatestPdf.ts  # Puppeteer web scraping
│   ├── pdfParser.ts        # PDF to JSON conversion
│   ├── dataExtractor.ts    # Main data extraction logic
│   ├── gameDataExtractor.ts # Specific game parsing
│   ├── pageParserUtils.ts  # Parsing utility functions
│   ├── generateGamesSummary.ts # Summary generation
│   └── routes/             # Additional route handlers
├── views/
│   └── admin_dashboard.ejs # Admin control interface
├── persistent_app_files/
│   ├── downloaded_pdfs/    # Raw PDF storage
│   ├── parsed_pdf_data.json # Intermediate parsed data
│   └── extracted_games_output.json # Final structured data
├── Dockerfile              # Puppeteer-enabled container
└── fly.toml               # Fly.io deployment config
```

---

## Operational Procedures

### Production Data Update Workflow

1. **Admin Triggers Scraping**
   - Access: `https://ols-viikkopelit-admin.fly.dev/`
   - Action: "Trigger Full Data Update"
   - Monitor: Fly.io logs for admin app

2. **Data Processing Completes**
   - PDF downloaded and parsed
   - Game data extracted and saved
   - API endpoint updated with new data

3. **Main App Refresh**
   - Access: `https://ols-viikkopelit.fly.dev/admin`
   - Action: "Reload Data from Shared Storage"
   - Monitor: Fly.io logs for main app

4. **User Access**
   - Updated schedules available at: `https://ols-viikkopelit.fly.dev/`

### Local Development Setup

1. **Main App**:
   ```bash
   npm install
   npm run build
   npm run dev  # Runs on localhost:3002
   ```

2. **Admin App**:
   ```bash
   cd admin_app
   npm install
   npm run build
   npm run dev  # Runs on localhost:3003
   ```

### Deployment Commands

1. **Main App**:
   ```bash
   fly deploy  # From project root
   ```

2. **Admin App**:
   ```bash
   cd admin_app
   fly deploy
   ```

---

## Data Formats

### Input: PDF Schedule
- **Source**: https://ols.fi/jalkapallo/viikkopelit/
- **Format**: Weekly game schedule PDF
- **Content**: Team names, game times, field locations, league information

### Intermediate: Parsed JSON
- **File**: `parsed_pdf_data.json`
- **Structure**: Text elements with coordinate positions
- **Purpose**: Structured representation of PDF layout

### Output: Game Data
- **File**: `extracted_games_output.json`
- **Structure**:
  ```json
  {
    "teams": {
      "TeamName Year": {
        "games": [
          {
            "time": "HH:MM",
            "date": "DD.MM",
            "opponent": "Opponent Name",
            "field": "Field Name",
            "year": "YYYY"
          }
        ]
      }
    }
  }
  ```

---

## Performance Metrics & Achievements

### Before Optimization
- **Startup Time**: 15+ seconds
- **Monthly Cost**: $6.07
- **Docker Image**: 1.64GB
- **Security Issues**: Multiple vulnerabilities

### After Optimization
- **Startup Time**: 78ms (99.5%+ improvement)
- **Monthly Cost**: $0.39 (83% reduction)
- **Docker Image**: 59MB compressed (91% smaller)
- **Security Issues**: Zero vulnerabilities
- **Annual Savings**: ~$68/year

### Key Optimization Techniques
1. **Multi-stage Docker builds** with production-only dependencies
2. **Critical CSS inlining** for instant rendering
3. **Async data loading** for non-blocking startup
4. **Sleep mode configuration** for cost savings
5. **Node 22 Alpine** for security and size optimization
6. **Right-sized infrastructure** (256MB RAM, shared CPU)

---

## Monitoring & Maintenance

### Health Checks
- **Main App**: `/health` endpoint
- **Admin App**: `/health` endpoint
- **Fly.io**: Automatic health monitoring

### Log Monitoring
```bash
fly logs -a ols-viikkopelit        # Main app logs
fly logs -a ols-viikkopelit-admin  # Admin app logs
```

### Volume Management
- **Main App Volume**: `ols_data` (1GB)
- **Admin App Volume**: `ols_admin_data` (1GB)
- **Backup Strategy**: Data persists across deployments

### Cost Monitoring
- **Current**: $0.39/month per app
- **Breakdown**: 90% sleep time, minimal storage, optimized compute
- **Scaling**: Auto-sleep after 5 minutes of inactivity

---

## Future Enhancements

### Automation Opportunities
- **Scheduled Updates**: External cron service integration
- **API Webhooks**: Automatic trigger when new PDFs published
- **Error Notifications**: Alert system for failed updates

### Feature Possibilities
- **Mobile App**: Native mobile interface
- **Push Notifications**: Game reminders
- **Calendar Integration**: Export to calendar applications
- **Team Statistics**: Historical game data analysis

This ultra-optimized application demonstrates how modern DevOps practices can achieve significant improvements in performance, cost, and security while maintaining robust functionality for specialized use cases like sports schedule management.
