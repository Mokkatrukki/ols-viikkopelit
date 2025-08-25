# Shared Database Architecture

## Overview

The OLS Viikkopelit application now uses a **shared SQLite database architecture** where:

- **Admin App** (`ols-viikkopelit-admin`): Handles all **WRITE** operations (PDF scraping, data processing, database updates)
- **Main App** (`ols-viikkopelit`): Handles all **READ** operations (serving users, displaying schedules)
- **Shared Database**: Single `games.db` file that both apps access

## Architecture Benefits

✅ **Simplified Data Flow**: No more API calls between apps  
✅ **Real-time Updates**: Main app sees changes instantly  
✅ **Clear Separation**: Admin writes, main app reads  
✅ **Cost Effective**: Single database, no replication complexity  
✅ **Better Performance**: Direct SQLite access (no network calls)  

## Database Setup

### Local Development
```
admin_app/persistent_app_files/games.db  <-- Admin app writes here
                                    ↑
                                    └─── Main app reads from here
```

### Production (Fly.io)
Both apps will mount the same shared volume containing `games.db`

## Database Access Patterns

### Admin App (Writer)
- **Database Mode**: READ + WRITE
- **Responsibilities**:
  - Create/update database schema
  - Process PDF data → insert games
  - Track processing history
  - Provide admin dashboard

### Main App (Reader)
- **Database Mode**: READ ONLY
- **Responsibilities**:
  - Display game schedules to users
  - Serve team selection interface
  - Provide fast user experience

## Implementation Details

### Database Path Configuration

**Admin App** (write mode):
```typescript
// admin_app/src/database.ts
const persistentStoragePath = process.env.APP_PERSISTENT_STORAGE_PATH || 
  path.join(__dirname, '../persistent_app_files');
this.dbPath = path.join(persistentStoragePath, 'games.db');
```

**Main App** (read-only mode):
```typescript
// src/database.ts
const adminDbPath = process.env.SHARED_GAMES_DB_PATH || 
  path.join(__dirname, '../admin_app/persistent_app_files/games.db');
this.dbPath = adminDbPath;

// Open in READ-ONLY mode
this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, ...);
```

### Environment Variables

**Local Development**:
- `SHARED_GAMES_DB_PATH`: Path to shared database (optional, auto-detected)
- `APP_PERSISTENT_STORAGE_PATH`: Admin app storage path

**Production**:
- Both apps will use shared volume mount point

## Data Flow

1. **Admin triggers update** → Admin app scrapes PDF
2. **Admin app processes** → Extracts games → Writes to `games.db`
3. **Main app serves users** → Reads from same `games.db` → Displays schedules
4. **Real-time updates** → Changes appear immediately (no API delays)

## API Endpoints Removed

The following endpoints are **no longer needed**:

- ❌ `POST /trigger-pdf-update` (main app)
- ❌ `GET /api/internal/latest-games-data` (admin app API)
- ❌ Admin refresh page functionality

## Development Workflow

### Start Admin App First
```bash
cd admin_app
npm run dev  # Runs on localhost:3003
```

### Then Start Main App
```bash
npm run dev  # Runs on localhost:3002
```

### Trigger Data Update
1. Go to `http://localhost:3003` (admin dashboard)
2. Click "Trigger Full Data Update"
3. Data automatically available at `http://localhost:3002`

## Production Deployment

### Admin App
- Higher resource allocation (for Puppeteer)
- Always-on or scheduled wake-up
- Handles heavy data processing

### Main App  
- Lightweight, optimized for speed
- Sleep mode enabled (cost savings)
- Fast user serving

### Shared Storage
- Single Fly.io volume mounted to both apps
- Or external database service (if scaling needed)

## Monitoring

### Health Checks
- **Admin App**: `GET /health` (includes write capability status)
- **Main App**: `GET /health` (includes shared database read status)

### Log Monitoring
```bash
fly logs -a ols-viikkopelit-admin  # Admin operations
fly logs -a ols-viikkopelit        # User serving
```

This architecture eliminates the complex API dependency while maintaining the proven two-app separation for optimal resource allocation and cost efficiency.
