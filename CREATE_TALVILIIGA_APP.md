# Create Talviliiga Tournament Viewer App

## Project Goal

Create a **new, simplified, standalone tournament viewer app** called `talviliiga` that displays tournament games from Excel files. This should be **simpler, faster, and more focused** than the existing OLS Viikkopelit app.

## Key Requirements

### 1. **Separate App - Don't Touch OLS Viikkopelit**
- Create brand new directory: `talviliiga/`
- Keep existing `ols-viikkopelit/` and `admin_app/` completely unchanged
- This is a standalone project that can be deployed separately

### 2. **Simple Architecture - Single App Only**
- **No admin app** - We don't need a separate microservice
- **No PDF parsing** - Only Excel files
- **No auto-updates** - Manual update workflow is fine
- **No complex API calls** - Everything runs in one app

### 3. **Data Source: Excel Files**
- Tournament schedules come from Excel files like `Talviliigan 2025-2026 Otteluohjelmat 4v4_5v5.xlsx`
- Excel has tabs: "5v5 turnaukset" and "4v4 turnaukset"
- Excel parser already exists and works! See `excel_parser/src/excelParser.ts`
- Parser outputs JSON in this format:
  ```
  {
    "documentDate": "12.11.2025",
    "games": [
      {
        "field": "Kenttä 1",
        "gameDuration": "25MIN",
        "gameType": "5 v 5",
        "year": "2009",
        "time": "08:30",
        "team1": "Ajax P9 Valkoinen",
        "team2": "Tervarit 17 Musta",
        "date": "15.11",
        "location": "Kempele Areena"
      }
    ]
  }
  ```

### 4. **UI Requirements**
- **Team-based view** (like current OLS app, not date-based)
- User selects a team from dropdown → sees their game schedule
- Display: date, time, opponent, location, field, game duration
- Clean, simple Tailwind CSS design
- Mobile responsive

### 5. **Update Workflow**
- Developer updates Excel file locally
- Run parser to generate JSON
- Commit and deploy
- **No web upload UI needed** - keep it simple!

### 6. **Performance Requirements**
- ⚡ **MUST START FASTER than current OLS app**
- Current OLS app: ~12ms startup, ~46ms data load
- Target: **< 10ms total startup**
- See "Performance Anti-Patterns to Avoid" section below

## Files to Study

### **GOOD Examples to Copy From:**

1. **`ols-viikkopelit/views/index.ejs`**
   - ✅ Team selector dropdown UI
   - ✅ Game schedule display layout
   - ✅ Critical CSS inlining technique
   - ✅ Loading states
   - ❌ SKIP: Base team portal logic (too complex)
   - ❌ SKIP: Admin refresh UI

2. **`ols-viikkopelit/src/app.ts`**
   - ✅ Express setup
   - ✅ Game data loading from JSON
   - ✅ Team filtering logic
   - ✅ Security headers
   - ✅ Health check endpoint
   - ❌ SKIP: Lines 1-46 (complex error handling - keep simple)
   - ❌ SKIP: Admin routes (`/admin`, `/admin/refresh-action`)
   - ❌ SKIP: Base team grouping algorithm (lines 84-165, too complex)
   - ❌ SKIP: axios calls to admin app

3. **`excel_parser/src/excelParser.ts`**
   - ✅ Full Excel parsing logic - **COPY THIS**
   - ✅ Works perfectly, outputs correct JSON format
   - ✅ Can be integrated directly into the app or run as separate script

4. **`ols-viikkopelit/Dockerfile`**
   - ✅ Multi-stage build pattern
   - ✅ Node 22 Alpine (minimal size)
   - ✅ Non-root user security
   - ❌ SKIP: Can be simpler for tournament app (no admin complexity)

5. **`ols-viikkopelit/fly.toml`**
   - ✅ 256MB RAM config
   - ✅ Auto-stop for cost savings
   - ✅ Health check setup
   - ✅ Volume mount pattern (adapt for tournament data)

### **BAD Examples - Don't Copy:**

1. **`admin_app/`** - Entire directory
   - ❌ Too complex, we don't need separate admin service
   - ❌ Puppeteer/PDF parsing not needed
   - ❌ Skip entirely

2. **`ols-viikkopelit/src/app.ts` - Complex team grouping**
   - ❌ Lines 84-165: Dynamic base team detection
   - ❌ Longest common prefix algorithm
   - ❌ Hierarchical team organization
   - **Why skip:** Tournament teams are simpler, don't need this complexity

## Performance Anti-Patterns to AVOID

### ❌ **DON'T: Sync file operations in startup**
```typescript
// BAD - Blocks startup
const data = JSON.parse(fs.readFileSync('data.json', 'utf-8'));
app.listen(3000); // Server starts only after file read
```

### ✅ **DO: Async data loading, start server immediately**
```typescript
// GOOD - Server starts fast, data loads in background
let gameData = [];
async function loadData() {
  const data = await fs.promises.readFile('data.json', 'utf-8');
  gameData = JSON.parse(data);
}
loadData(); // Don't await!
app.listen(3000); // Server starts immediately
```

### ❌ **DON'T: Heavy computation in startup**
- Team grouping algorithms
- Image processing
- Complex data transformations
- **Do these only when needed (on route handlers)**

### ✅ **DO: Lazy computation**
- Load JSON file async
- Pre-compute team list if needed, but don't block startup
- Cache computed values

### ❌ **DON'T: Large dependencies**
- Puppeteer (180MB+)
- Heavy image processing libraries
- Unnecessary ORMs or database drivers
- **Tournament app needs: express, ejs, xlsx only**

### ✅ **DO: Minimal dependencies**
```json
{
  "dependencies": {
    "express": "^5.1.0",
    "ejs": "^3.1.10",
    "xlsx": "^0.18.5"  // Only if parsing in-app
  }
}
```

### ❌ **DON'T: Complex middleware chains**
- Multiple body parsers
- Heavy logging middleware in production
- Complex session management
- **Keep middleware minimal for tournaments**

### ✅ **DO: Essential middleware only**
```typescript
app.use(express.static('public'));
app.set('view engine', 'ejs');
// Security headers
// That's it!
```

## Recommended Project Structure

```
talviliiga/
├── src/
│   ├── app.ts              # Main Express server (simplified)
│   └── input.css           # Minimal Tailwind
├── views/
│   └── index.ejs           # Team selector + game schedule
├── public/
│   ├── css/
│   │   └── style.css       # Built Tailwind CSS
│   └── images/
│       ├── kempele.webp    # Venue maps
│       └── kurikka.webp
├── data/
│   ├── talviliiga.xlsx     # Source Excel file
│   └── games.json          # Parsed game data (gitignored or committed)
├── scripts/
│   └── parseExcel.ts       # Excel parser (from excel_parser)
├── dist/                   # Compiled TypeScript
├── Dockerfile
├── fly.toml
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── README.md
```

## Data Update Workflow

```bash
# Step 1: Update Excel file
cp new-schedule.xlsx data/talviliiga.xlsx

# Step 2: Parse Excel to JSON
npm run parse
# → Generates data/games.json

# Step 3: Deploy
git add data/
git commit -m "Update tournament schedule"
fly deploy
```

## Key Simplifications vs OLS App

| Feature | OLS Viikkopelit | Talviliiga (New) | Why Simplify? |
|---------|-----------------|------------------|---------------|
| **Architecture** | Main app + Admin app | Single app only | No auto-updates needed |
| **Data Source** | PDF scraping (Puppeteer) | Excel files (xlsx) | Static tournament schedule |
| **Updates** | Scheduled auto-scraping | Manual deploy | Tournaments are fixed, not weekly |
| **Team Grouping** | Complex hierarchical algorithm | Simple list | Tournament teams are flat |
| **Dependencies** | express, ejs, axios, dotenv | express, ejs, xlsx | Minimal surface area |
| **Startup Logic** | Async data load, complex grouping | Async data load, simple list | Faster cold starts |
| **Admin UI** | Full dashboard | None | Update via deploy |
| **Docker Image** | ~59MB | Target: <50MB | Fewer deps |
| **Memory** | 256MB | 256MB | Same |
| **Deployment** | 2 apps on Fly.io | 1 app | Simpler, cheaper |

## Implementation Strategy

### Phase 1: Basic App Structure
1. Create `talviliiga/` directory
2. Copy minimal package.json (express, ejs, xlsx only)
3. Copy and simplify `app.ts` from OLS
   - Remove admin routes
   - Remove axios calls
   - Remove complex team grouping
   - Keep: game filtering by team, health check
4. Copy `index.ejs` from OLS
   - Keep: team selector, game display
   - Remove: admin section, base team portals
5. Setup Tailwind (copy config)

### Phase 2: Excel Integration
1. Copy `excel_parser/src/excelParser.ts` to `scripts/parseExcel.ts`
2. Add npm script: `"parse": "ts-node scripts/parseExcel.ts"`
3. Configure to read from `data/talviliiga.xlsx`
4. Configure to output to `data/games.json`
5. Test parsing with existing Excel file

### Phase 3: UI Adaptations
1. Update branding (OLS → Talviliiga)
2. Add date/location display to game cards
3. Show tournament dates prominently
4. Only 2 venue maps needed (Kempele Areena, Kurikkahaantien halli)
5. Test responsive design

### Phase 4: Deployment
1. Create `Dockerfile` (simpler than OLS - no Puppeteer)
2. Create `fly.toml` with new app name: `talviliiga`
3. Set up Fly.io volume for data (optional, could commit JSON)
4. Deploy: `fly launch` then `fly deploy`
5. Test cold start performance

### Phase 5: Documentation
1. Write README.md with update workflow
2. Document Excel file format requirements
3. Add deployment instructions

## Testing Checklist

- [ ] Parser generates valid JSON from Excel
- [ ] App starts in < 10ms (measure with logs)
- [ ] Team dropdown shows all teams
- [ ] Selecting team shows correct games
- [ ] Date and location display correctly
- [ ] Works on mobile
- [ ] Fly.io deployment succeeds
- [ ] Cold start is fast
- [ ] Health check responds

## Success Criteria

✅ **Single standalone app** (no admin app dependency)
✅ **< 10ms cold start** (faster than OLS)
✅ **< 5 dependencies** in package.json
✅ **Works with existing Excel file** (348 games)
✅ **Clean UI** (adapted from OLS design)
✅ **Simple deploy workflow** (update Excel → parse → deploy)
✅ **Low cost** (~$0.39/month on Fly.io)

## Notes for Implementation

- **Don't over-engineer**: The OLS app is feature-rich because it needs to be. This tournament app should be intentionally simpler.
- **Performance first**: Every decision should ask "does this slow down cold start?"
- **Copy, don't rewrite**: Most UI/UX from OLS is great, just adapt it
- **Test with real data**: Use the existing Excel file with 348 games
- **Keep it maintainable**: Future you (or someone else) should understand this in 5 minutes

## References

- Working Excel parser: `excel_parser/src/excelParser.ts`
- UI reference: `ols-viikkopelit/views/index.ejs`
- Backend reference: `ols-viikkopelit/src/app.ts`
- Deployment reference: `ols-viikkopelit/Dockerfile` and `fly.toml`
- Excel file: `admin_app/Talviliigan 2025-2026 Otteluohjelmat 4v4_5v5.xlsx`

---

**TL;DR**: Create a simpler, faster version of OLS Viikkopelit specifically for static tournament schedules. Single app, Excel-based, manual updates, team-based view, < 10ms startup. Copy the good parts from OLS, skip the complex parts, integrate working Excel parser.
