# LiteFS Hybrid Architecture: Shared SQLite Database

## Overview

This approach maintains the **two-app separation** while using **LiteFS for shared SQLite storage**. The admin app handles data processing and writes, while the main app focuses purely on serving users with read-only access.

### Architecture Benefits
- ✅ **Keep existing separation** of admin vs viewer concerns
- ✅ **Eliminate API complexity** - no HTTP calls between apps
- ✅ **Real-time updates** - changes appear instantly in main app
- ✅ **Better performance** - local SQLite reads for main app
- ✅ **Simplified deployment** - shared database, independent apps

---

## Shared Database Architecture

### Database Access Patterns
```
┌─────────────────┐    ┌──────────────────┐
│   Admin App     │    │   Main Viewer    │
│                 │    │     App          │
│  - PDF Scraping │    │  - User Interface│
│  - Data Extract │    │  - Game Display  │
│  - SQLite WRITE │    │  - SQLite READ   │
│  - Dashboard    │    │  - Team Selection│
└─────────────────┘    └──────────────────┘
         │                       │
         │      READ/WRITE       │ READ ONLY
         │                       │
         └───────────────────────┘
                    │
            ┌───────▼────────┐
            │  LiteFS Shared │
            │  SQLite DB     │
            │  (games.db)    │
            └────────────────┘
```

### LiteFS Configuration
- **Primary Node**: Admin app (handles writes)
- **Replica Nodes**: Main app instances (read-only)
- **Automatic Replication**: Changes sync instantly
- **Regional Distribution**: Main app replicas worldwide

---

## Implementation Plan

### Phase 1: Shared Database Schema

#### Step 1.1: Create Unified Schema
```sql
-- shared-schema.sql
CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    year INTEGER NOT NULL,
    league TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, year)
);

CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL,
    opponent TEXT NOT NULL,
    game_date DATE NOT NULL,
    game_time TIME NOT NULL,
    field TEXT NOT NULL,
    home_team BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams (id)
);

CREATE TABLE pdf_processing_log (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    download_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    checksum TEXT,
    status TEXT DEFAULT 'downloaded', -- downloaded, processing, completed, failed
    error_message TEXT,
    games_extracted INTEGER DEFAULT 0
);

-- Performance indexes
CREATE INDEX idx_games_team_date ON games(team_id, game_date);
CREATE INDEX idx_teams_name_year ON teams(name, year);
CREATE INDEX idx_pdf_status ON pdf_processing_log(status, processed_at);

-- View for easy team lookup with game counts
CREATE VIEW team_summary AS
SELECT 
    t.id,
    t.name,
    t.year,
    t.league,
    COUNT(g.id) as total_games,
    MIN(g.game_date) as first_game,
    MAX(g.game_date) as last_game
FROM teams t
LEFT JOIN games g ON t.id = g.team_id
GROUP BY t.id, t.name, t.year, t.league;
```

### Phase 2: Admin App Updates (Writer)

#### Step 2.1: Admin App LiteFS Configuration
```yaml
# admin_app/litefs.yml
fuse:
  dir: "/var/lib/litefs"

data:
  dir: "/var/lib/litefs/data"

proxy:
  addr: ":8080"
  target: "localhost:3003"  # Admin app port
  db: "games.db"

lease:
  type: "consul"
  candidate: true  # Admin app is always primary candidate
  promote: true
  
exec:
  - cmd: ["node", "dist/admin_app.js"]

# Write permissions enabled for primary
backup:
  type: "s3"
  bucket: "ols-viikkopelit-backups"
  path: "databases"
  retention: "168h"  # 7 days
```

#### Step 2.2: Update Admin App Dockerfile
```dockerfile
# admin_app/Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
# Install LiteFS and dependencies
RUN apk add ca-certificates fuse3 sqlite

# Copy LiteFS binary
COPY --from=flyio/litefs:0.5 /usr/local/bin/litefs /usr/local/bin/litefs

# Copy application
WORKDIR /app
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package*.json ./
COPY --chown=node:node litefs.yml /etc/litefs.yml
COPY --chown=node:node shared-schema.sql ./

# Initialize database if it doesn't exist
RUN mkdir -p /var/lib/litefs/data

USER node
EXPOSE 8080
ENTRYPOINT ["litefs", "mount"]
```

#### Step 2.3: Admin App Database Layer
```javascript
// admin_app/src/database.js
const sqlite3 = require('sqlite3').verbose();

class AdminDatabase {
    constructor() {
        this.db = new sqlite3.Database('/var/lib/litefs/games.db');
        this.initializeSchema();
    }

    async initializeSchema() {
        const fs = require('fs');
        const schema = fs.readFileSync('./shared-schema.sql', 'utf8');
        
        return new Promise((resolve, reject) => {
            this.db.exec(schema, (err) => {
                if (err && !err.message.includes('already exists')) {
                    reject(err);
                } else {
                    console.log('Database schema initialized');
                    resolve();
                }
            });
        });
    }

    async startProcessing(filename) {
        return new Promise((resolve, reject) => {
            this.db.run(`
                INSERT INTO pdf_processing_log (filename, status) 
                VALUES (?, 'processing')
            `, [filename], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    }

    async saveExtractedData(processingId, teamsData) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN TRANSACTION');
                
                try {
                    let gamesExtracted = 0;
                    
                    for (const [teamKey, teamData] of Object.entries(teamsData)) {
                        // Parse team name and year from key
                        const [name, year] = this.parseTeamKey(teamKey);
                        
                        // Insert or get team
                        this.db.run(`
                            INSERT OR IGNORE INTO teams (name, year, updated_at) 
                            VALUES (?, ?, CURRENT_TIMESTAMP)
                        `, [name, year]);
                        
                        // Get team ID
                        this.db.get(`
                            SELECT id FROM teams WHERE name = ? AND year = ?
                        `, [name, year], (err, team) => {
                            if (err) throw err;
                            
                            // Clear existing games for this team
                            this.db.run(`
                                DELETE FROM games WHERE team_id = ?
                            `, [team.id]);
                            
                            // Insert new games
                            teamData.games.forEach(game => {
                                this.db.run(`
                                    INSERT INTO games (team_id, opponent, game_date, game_time, field)
                                    VALUES (?, ?, ?, ?, ?)
                                `, [team.id, game.opponent, game.date, game.time, game.field]);
                                gamesExtracted++;
                            });
                        });
                    }
                    
                    // Update processing log
                    this.db.run(`
                        UPDATE pdf_processing_log 
                        SET status = 'completed', 
                            processed_at = CURRENT_TIMESTAMP,
                            games_extracted = ?
                        WHERE id = ?
                    `, [gamesExtracted, processingId]);
                    
                    this.db.run('COMMIT');
                    resolve(gamesExtracted);
                    
                } catch (error) {
                    this.db.run('ROLLBACK');
                    reject(error);
                }
            });
        });
    }

    parseTeamKey(teamKey) {
        // Extract team name and year from "TeamName Year" format
        const parts = teamKey.split(' ');
        const year = parseInt(parts[parts.length - 1]);
        const name = parts.slice(0, -1).join(' ');
        return [name, year];
    }

    async getProcessingHistory() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT * FROM pdf_processing_log 
                ORDER BY download_date DESC 
                LIMIT 20
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
}

module.exports = AdminDatabase;
```

#### Step 2.4: Update Admin App Logic
```javascript
// admin_app/src/admin_app.ts
import express from 'express';
import AdminDatabase from './database.js';

const app = express();
const db = new AdminDatabase();

// Dashboard - show processing status
app.get('/', async (req, res) => {
    try {
        const history = await db.getProcessingHistory();
        res.render('admin_dashboard', { 
            history,
            title: 'OLS Admin - SQLite Database'
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Trigger data update
app.post('/trigger-update', async (req, res) => {
    try {
        console.log('Starting PDF update process...');
        
        // 1. Download PDF
        const filename = await updateLatestPdf();
        
        // 2. Start processing record
        const processingId = await db.startProcessing(filename);
        
        // 3. Parse PDF
        await pdfParser();
        
        // 4. Extract data
        const extractedData = await dataExtractor();
        
        // 5. Save to SQLite (LiteFS will replicate automatically)
        const gamesCount = await db.saveExtractedData(processingId, extractedData.teams);
        
        console.log(`Successfully processed ${gamesCount} games`);
        res.json({ 
            success: true, 
            message: `Processed ${gamesCount} games`,
            filename 
        });
        
    } catch (error) {
        console.error('Update failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'admin', database: 'sqlite+litefs' });
});

app.listen(3003, () => {
    console.log('Admin app running on port 3003 with LiteFS SQLite');
});
```

### Phase 3: Main App Updates (Reader)

#### Step 3.1: Main App LiteFS Configuration
```yaml
# litefs.yml (main app)
fuse:
  dir: "/var/lib/litefs"

data:
  dir: "/var/lib/litefs/data"

proxy:
  addr: ":8080"
  target: "localhost:3002"  # Main app port
  db: "games.db"

lease:
  type: "consul"
  candidate: false  # Main app is read-only replica
  
exec:
  - cmd: ["node", "dist/app.js"]

# Read-only replica configuration
replica:
  url: "https://ols-viikkopelit-admin.fly.dev"  # Connect to admin app
```

#### Step 3.2: Main App Database Layer
```javascript
// src/database.js (main app)
const sqlite3 = require('sqlite3').verbose();

class ViewerDatabase {
    constructor() {
        this.db = new sqlite3.Database('/var/lib/litefs/games.db', sqlite3.OPEN_READONLY);
    }

    async getTeamsByYear() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT * FROM team_summary 
                ORDER BY year DESC, name ASC
            `, (err, rows) => {
                if (err) reject(err);
                else {
                    // Group by year
                    const grouped = rows.reduce((acc, team) => {
                        if (!acc[team.year]) acc[team.year] = [];
                        acc[team.year].push(team);
                        return acc;
                    }, {});
                    resolve(grouped);
                }
            });
        });
    }

    async getGamesByTeam(teamName, year) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT g.*, t.name as team_name, t.year
                FROM games g
                JOIN teams t ON g.team_id = t.id
                WHERE t.name = ? AND t.year = ?
                ORDER BY g.game_date ASC, g.game_time ASC
            `, [teamName, year], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getLastUpdateInfo() {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT filename, processed_at, games_extracted
                FROM pdf_processing_log
                WHERE status = 'completed'
                ORDER BY processed_at DESC
                LIMIT 1
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}

module.exports = ViewerDatabase;
```

#### Step 3.3: Update Main App
```javascript
// src/app.ts (main app)
import express from 'express';
import ViewerDatabase from './database.js';

const app = express();
const db = new ViewerDatabase();

// Home page with team selection
app.get('/', async (req, res) => {
    try {
        const teamsByYear = await db.getTeamsByYear();
        const lastUpdate = await db.getLastUpdateInfo();
        
        res.render('index', { 
            teamsByYear,
            lastUpdate,
            title: 'OLS Viikkopelit'
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).send('Database connection error');
    }
});

// Team schedule
app.get('/team/:name/:year', async (req, res) => {
    try {
        const { name, year } = req.params;
        const games = await db.getGamesByTeam(name, parseInt(year));
        const teamsByYear = await db.getTeamsByYear(); // For navigation
        
        res.render('team_schedule', { 
            games,
            teamName: name,
            year: parseInt(year),
            teamsByYear,
            title: `${name} ${year} - OLS Viikkopelit`
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).send('Error loading team schedule');
    }
});

// Admin page (read-only status)
app.get('/admin', async (req, res) => {
    try {
        const lastUpdate = await db.getLastUpdateInfo();
        res.render('admin_readonly', { 
            lastUpdate,
            adminUrl: 'https://ols-viikkopelit-admin.fly.dev',
            title: 'Admin Status'
        });
    } catch (error) {
        res.status(500).send('Error loading admin status');
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'viewer', database: 'sqlite+litefs-readonly' });
});

app.listen(3002, () => {
    console.log('Viewer app running on port 3002 with read-only LiteFS SQLite');
});
```

### Phase 4: Deployment Configuration

#### Step 4.1: Admin App fly.toml
```toml
# admin_app/fly.toml
app = "ols-viikkopelit-admin"
primary_region = "arn"

[build]

[env]
  NODE_ENV = "production"

[mounts]
  source = "litefs_admin"
  destination = "/var/lib/litefs"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1  # Keep admin always available

[[services.http_checks]]
  interval = "30s"
  timeout = "10s"
  grace_period = "10s"
  method = "GET"
  path = "/health"
```

#### Step 4.2: Main App fly.toml
```toml
# fly.toml (main app)
app = "ols-viikkopelit"

[build]

[env]
  NODE_ENV = "production"

[mounts]
  source = "litefs_viewer"
  destination = "/var/lib/litefs"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0  # Sleep mode for cost savings

[[services.http_checks]]
  interval = "30s"
  timeout = "10s"
  grace_period = "10s"
  method = "GET"
  path = "/health"
```

---

## Deployment Steps

### Step 1: Deploy Admin App (Primary/Writer)
```bash
cd admin_app

# Create volume for admin app
fly volumes create litefs_admin --size 10 --region arn

# Attach Consul for lease management
fly consul attach

# Deploy admin app as primary
fly deploy --region arn
```

### Step 2: Deploy Main App (Replicas/Readers)
```bash
# Create volumes for different regions
fly volumes create litefs_viewer --size 10 --region arn  # Stockholm
fly volumes create litefs_viewer --size 10 --region lhr  # London
fly volumes create litefs_viewer --size 10 --region dfw  # Dallas

# Attach Consul
fly consul attach

# Deploy to multiple regions
fly deploy --region arn  # Primary region
fly machine clone --region lhr  # London replica
fly machine clone --region dfw  # Dallas replica
```

---

## Benefits of This Hybrid Approach

### Operational Benefits
- ✅ **Clear separation**: Admin for processing, viewer for users
- ✅ **Independent scaling**: Scale viewer replicas without affecting admin
- ✅ **Specialized optimization**: Different configs for different workloads
- ✅ **Easier debugging**: Clear boundaries between concerns

### Performance Benefits
- ✅ **Real-time updates**: Changes appear instantly (no API polling)
- ✅ **Local reads**: SQLite queries are microsecond-fast
- ✅ **Global distribution**: Viewers in every region
- ✅ **No network dependencies**: Main app doesn't call admin app

### Cost Benefits
- ✅ **Efficient resource usage**: Admin always-on, viewer sleep-mode
- ✅ **Reduced complexity**: No API authentication/retry logic
- ✅ **Better caching**: SQLite handles caching optimally

### Development Benefits
- ✅ **Familiar structure**: Keep existing app separation
- ✅ **Gradual migration**: Can migrate one app at a time
- ✅ **Easy rollback**: Falls back to current architecture if needed

---

## Migration Strategy

### Phase 1: Admin App (Week 1-2)
1. Add LiteFS to admin app
2. Replace JSON with SQLite writes
3. Test PDF processing → SQLite workflow

### Phase 2: Main App (Week 3)
1. Add LiteFS to main app as read-only replica
2. Replace JSON reads with SQLite reads
3. Test replication from admin to viewer

### Phase 3: Production (Week 4)
1. Deploy admin app with LiteFS
2. Deploy viewer replicas globally
3. Monitor replication and performance
4. Remove old JSON-based workflow

This approach gives you the best of both worlds: **simplified data layer** with **preserved application boundaries**!
