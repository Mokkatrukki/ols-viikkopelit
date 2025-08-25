# LiteFS Migration Plan: Eliminating Admin App Dependencies

## Current Architecture Problems

### Existing Issues
- **Two-app complexity**: Separate admin and viewer apps require coordination
- **API dependency**: Main app depends on admin app API for data updates
- **Manual sync process**: Requires manual triggering of data refresh
- **Network latency**: API calls between services add latency
- **Single point of failure**: Admin app downtime affects data updates

### Current Data Flow (Complex)
1. Admin app scrapes PDF → processes → saves to volume
2. Admin app exposes API endpoint
3. Main app calls admin API → downloads JSON → saves locally
4. Users access main app with locally cached data

---

## LiteFS Solution Overview

### What LiteFS Enables
- **Distributed SQLite**: Real-time replication across multiple regions
- **No API dependency**: Direct database access on all nodes
- **Automatic sync**: Changes propagate automatically
- **Better performance**: Local SQLite queries (no network calls)
- **Simplified architecture**: Single app type with distributed data

### New Architecture Vision
1. **Single app type** deployed to multiple regions
2. **Primary node** handles PDF scraping and data processing
3. **Replica nodes** automatically receive updates via LiteFS
4. **All nodes** serve users with local SQLite data

---

## Migration Plan: Step-by-Step

### Phase 1: Prepare SQLite Schema

#### Step 1.1: Design Database Schema
```sql
-- games.sql
CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    year INTEGER NOT NULL,
    league TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, year)
);

CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL,
    opponent TEXT NOT NULL,
    game_date DATE NOT NULL,
    game_time TIME NOT NULL,
    field TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams (id)
);

CREATE TABLE pdf_metadata (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    download_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    checksum TEXT,
    status TEXT DEFAULT 'downloaded' -- downloaded, processed, failed
);

CREATE INDEX idx_games_team_date ON games(team_id, game_date);
CREATE INDEX idx_teams_name_year ON teams(name, year);
```

#### Step 1.2: Create Data Migration Script
```javascript
// migrate-json-to-sqlite.js
const sqlite3 = require('sqlite3');
const fs = require('fs');

async function migrateJsonToSqlite() {
    const db = new sqlite3.Database('/var/lib/litefs/games.db');
    const jsonData = JSON.parse(fs.readFileSync('extracted_games_output.json'));
    
    // Migrate teams and games from JSON to SQLite
    for (const [teamKey, teamData] of Object.entries(jsonData.teams)) {
        // Extract team name and year from key
        // Insert team and games into SQLite
    }
}
```

### Phase 2: Integrate LiteFS

#### Step 2.1: Create LiteFS Configuration
```yaml
# litefs.yml
fuse:
  dir: "/var/lib/litefs"

data:
  dir: "/var/lib/litefs/data"

proxy:
  addr: ":8080"
  target: "localhost:3002"
  db: "games.db"

lease:
  type: "consul"
  candidate: ${FLY_REGION == "arn"}  # Make Stockholm primary
  promote: true
  
exec:
  - cmd: ["node", "dist/app.js"]
```

#### Step 2.2: Update Dockerfile
```dockerfile
FROM node:22-alpine AS build
# ... existing build steps ...

FROM node:22-alpine AS runtime
# Install LiteFS dependencies
RUN apk add ca-certificates fuse3 sqlite

# Copy LiteFS binary
COPY --from=flyio/litefs:0.5 /usr/local/bin/litefs /usr/local/bin/litefs

# Copy application
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/package*.json ./
COPY --chown=node:node litefs.yml /etc/litefs.yml

# Initialize database schema
COPY --chown=node:node schema.sql ./
RUN sqlite3 /var/lib/litefs/games.db < schema.sql

USER node
ENTRYPOINT ["litefs", "mount"]
```

### Phase 3: Refactor Application Logic

#### Step 3.1: Update Main App for SQLite
```javascript
// src/database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class GameDatabase {
    constructor() {
        this.db = new sqlite3.Database('/var/lib/litefs/games.db');
    }

    async getTeams() {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT name, year, COUNT(g.id) as game_count 
                FROM teams t 
                LEFT JOIN games g ON t.id = g.team_id 
                GROUP BY t.id, t.name, t.year 
                ORDER BY t.year DESC, t.name
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
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
                ORDER BY g.game_date, g.game_time
            `, [teamName, year], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
}

module.exports = GameDatabase;
```

#### Step 3.2: Add Primary Node Detection
```javascript
// src/app.js
const GameDatabase = require('./database');
const { isPrimaryNode, processPdfData } = require('./litefs-utils');

const db = new GameDatabase();

// Only primary node handles PDF processing
if (isPrimaryNode()) {
    console.log('This is the primary node - enabling PDF processing');
    
    // Schedule PDF updates (or handle via admin endpoint)
    app.post('/admin/update-data', async (req, res) => {
        try {
            await processPdfData(db);
            res.json({ success: true, message: 'Data updated successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

// All nodes can serve data (from local SQLite)
app.get('/api/teams', async (req, res) => {
    try {
        const teams = await db.getTeams();
        res.json(teams);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

#### Step 3.3: Integrate Admin Logic into Primary Node
```javascript
// src/litefs-utils.js
const fs = require('fs');

function isPrimaryNode() {
    // Check if this node holds the LiteFS lease
    try {
        const leaseInfo = fs.readFileSync('/var/lib/litefs/.primary', 'utf8');
        return leaseInfo.trim() === process.env.FLY_ALLOC_ID;
    } catch {
        return false;
    }
}

async function processPdfData(db) {
    // Move admin app logic here
    const updateLatestPdf = require('./admin/updateLatestPdf');
    const pdfParser = require('./admin/pdfParser');
    const dataExtractor = require('./admin/dataExtractor');
    
    // 1. Download latest PDF
    await updateLatestPdf();
    
    // 2. Parse PDF to JSON
    await pdfParser();
    
    // 3. Extract and save to SQLite
    const extractedData = await dataExtractor();
    await saveToDatabase(db, extractedData);
}

async function saveToDatabase(db, extractedData) {
    // Convert extracted JSON data to SQLite inserts
    for (const [teamKey, teamData] of Object.entries(extractedData.teams)) {
        // Insert team and games into SQLite
        // LiteFS automatically replicates to all nodes
    }
}

module.exports = { isPrimaryNode, processPdfData };
```

### Phase 4: Deploy with LiteFS

#### Step 4.1: Update fly.toml
```toml
[build]

[env]
  NODE_ENV = "production"

[mounts]
  source = "litefs"
  destination = "/var/lib/litefs"

[http_service]
  internal_port = 8080  # LiteFS proxy port
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[services.http_checks]]
  interval = "30s"
  timeout = "10s"
  grace_period = "10s"
  method = "GET"
  path = "/health"

[services.concurrency]
  type = "connections"
  hard_limit = 1000
  soft_limit = 800
```

#### Step 4.2: Deployment Commands
```bash
# Create LiteFS volume
fly volumes create litefs --size 10 --region arn

# Attach Consul for lease management
fly consul attach

# Deploy primary node in Stockholm
fly deploy --region arn

# Deploy replicas in other regions
fly machine clone --region lhr  # London
fly machine clone --region syd  # Sydney
fly machine clone --region dfw  # Dallas
```

### Phase 5: Testing & Validation

#### Step 5.1: Verify LiteFS Replication
```bash
# Check primary node status
fly ssh console --region arn
sqlite3 /var/lib/litefs/games.db "SELECT COUNT(*) FROM games;"

# Check replica synchronization
fly ssh console --region lhr
sqlite3 /var/lib/litefs/games.db "SELECT COUNT(*) FROM games;"
```

#### Step 5.2: Test Data Updates
```bash
# Trigger update on primary (Stockholm)
curl -X POST https://ols-viikkopelit.fly.dev/admin/update-data

# Verify data propagation to replicas
curl https://lhr.ols-viikkopelit.fly.dev/api/teams
curl https://syd.ols-viikkopelit.fly.dev/api/teams
```

---

## Benefits After Migration

### Performance Improvements
- **Faster queries**: Direct SQLite access (no network calls)
- **Regional optimization**: Users connect to nearest replica
- **Instant availability**: No API dependency delays

### Operational Simplifications
- **Single app type**: Easier to maintain and deploy
- **Automatic sync**: No manual data refresh needed
- **Built-in failover**: Primary election handled by LiteFS
- **Simplified monitoring**: One app to monitor instead of two

### Cost Optimizations
- **Reduced complexity**: Fewer moving parts
- **Better resource usage**: No idle admin app
- **Regional efficiency**: Serve users from closest location

---

## Migration Timeline

### Week 1: Preparation
- [ ] Design SQLite schema
- [ ] Create migration scripts
- [ ] Test LiteFS locally

### Week 2: Integration
- [ ] Update Dockerfile with LiteFS
- [ ] Refactor app for SQLite
- [ ] Add primary node detection

### Week 3: Testing
- [ ] Deploy to staging with LiteFS
- [ ] Test replication across regions
- [ ] Validate data consistency

### Week 4: Production Migration
- [ ] Migrate existing JSON data to SQLite
- [ ] Deploy to production
- [ ] Monitor performance and sync
- [ ] Decommission admin app

---

## Rollback Plan

### If Issues Occur
1. **Keep admin app running** during migration
2. **Dual-write approach**: Update both JSON and SQLite
3. **Feature flag**: Switch between LiteFS and admin API
4. **Data verification**: Compare SQLite vs JSON consistency

### Emergency Rollback
```bash
# Switch back to admin app architecture
fly secrets set USE_ADMIN_API=true
fly deploy --strategy immediate
```

---

## Future Enhancements with LiteFS

### Advanced Features
- **Real-time updates**: WebSocket notifications on data changes
- **Point-in-time recovery**: LiteFS built-in backup to S3
- **Multi-region writes**: Write forwarding for global updates
- **Analytics**: Query performance across regions

### Monitoring & Observability
- **LiteFS metrics**: Replication lag, sync status
- **Regional performance**: Query times per region
- **Data consistency**: Automated verification checks

This migration eliminates the complex two-app architecture while providing better performance, automatic failover, and global distribution of the OLS Viikkopelit application.
