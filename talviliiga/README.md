# Talviliiga Tournament Viewer

A simple, fast, and lightweight tournament schedule viewer for Talviliiga tournaments. Built specifically for static tournament schedules with performance and simplicity in mind.

## ⚡ Performance

- **< 10ms startup time** (achieved: **8ms**)
- Minimal dependencies (express, ejs only)
- No complex algorithms or heavy computation
- Async data loading for fast cold starts

## 🚀 Features

- Team-based view - select a team to see their schedule
- Display date, time, opponent, location, field, and game duration
- Clean, responsive Tailwind CSS design
- Mobile-friendly interface
- Parses tournament schedules from Excel files

## 📁 Project Structure

```
talviliiga/
├── src/
│   ├── app.ts              # Main Express server
│   └── input.css           # Tailwind CSS input
├── views/
│   └── index.ejs           # Main template
├── public/
│   ├── css/                # Built CSS files
│   └── images/             # Venue maps (optional)
├── data/
│   ├── talviliiga.xlsx     # Source Excel file
│   └── games.json          # Parsed game data
├── scripts/
│   └── parseExcel.ts       # Excel parser
├── dist/                   # Compiled TypeScript
├── Dockerfile              # Docker configuration
├── fly.toml                # Fly.io deployment config
└── package.json
```

## 🛠️ Development Setup

### Prerequisites

- Node.js 22+
- npm

### Installation

```bash
# Install dependencies
npm install

# Parse Excel file to generate games.json
npm run parse

# Build the application
npm run build

# Start the server
npm start
```

The app will be available at `http://localhost:3003`

### Development Mode

```bash
# Run in development mode with auto-reload
npm run dev
```

## 📊 Updating Tournament Data

1. **Update Excel file**: Replace `data/talviliiga.xlsx` with the new schedule
2. **Parse Excel**: Run `npm run parse` to generate `data/games.json`
3. **Rebuild**: Run `npm run build`
4. **Deploy**: Commit and deploy (see deployment section)

## 🐳 Docker

Build and run with Docker:

```bash
# Build image
docker build -t talviliiga .

# Run container
docker run -p 3003:3003 talviliiga
```

## 🚁 Deployment (Fly.io)

### Initial Setup

```bash
# Login to Fly.io
fly auth login

# Launch the app (first time)
fly launch --copy-config --yes

# Deploy
fly deploy
```

### Updating Schedule

```bash
# Update Excel file
cp new-schedule.xlsx data/talviliiga.xlsx

# Parse and rebuild
npm run parse
npm run build

# Deploy updated schedule
git add data/
git commit -m "Update tournament schedule"
fly deploy
```

### Monitoring

```bash
# View logs
fly logs

# Check app status
fly status

# Open app in browser
fly open
```

## 📝 Excel File Format

The Excel file should have two sheets:
- `5v5 turnaukset` - 5v5 tournament games
- `4v4 turnaukset` - 4v4 tournament games

Each sheet should contain:
- Date (Excel date format)
- Location (e.g., "Kempele Areena", "Kurikkahaantien halli")
- Game duration (e.g., "PELIAIKA 25MIN")
- Game rows with: Time | Team1 | Team2 (repeating pattern across columns)

## 🎯 Design Principles

1. **Simplicity First** - No unnecessary features or complexity
2. **Performance** - Fast startup, minimal dependencies
3. **Maintainability** - Easy to understand and modify
4. **Cost-Effective** - Low resource usage (~$0.39/month on Fly.io)

## 📈 Performance Comparison

| Metric | OLS Viikkopelit | Talviliiga |
|--------|-----------------|------------|
| Startup Time | ~12ms | **8ms** ✅ |
| Dependencies | 4 (express, ejs, axios, dotenv) | **2 (express, ejs)** |
| Architecture | 2 apps (main + admin) | **1 app** |
| Data Updates | Auto-scraping with Puppeteer | Manual Excel update |
| Docker Image | ~59MB | **< 50MB** |

## 🤝 Contributing

This is a simple, focused tool. If you want to add features, please ensure they:
- Don't slow down startup time
- Don't add unnecessary dependencies
- Keep the codebase simple and maintainable

## 📄 License

ISC

## 📊 Usage Analytics

The app includes request logging to track page views and usage statistics. After game days, you can check the logs to see how many people used the app.

### View Logs

```bash
# See recent logs with page views
fly logs --app talviliiga --no-tail | grep "📊"

# See live logs (real-time)
fly logs --app talviliiga -f
```

### Usage Statistics

```bash
# Count total page views
fly logs --app talviliiga --no-tail | grep "📊" | wc -l

# Count unique visitors (approximate)
fly logs --app talviliiga --no-tail | grep "📊" | grep -oP 'IP: \K[^\s]+' | sort -u | wc -l

# See which teams/pages are most popular
fly logs --app talviliiga --no-tail | grep "📊" | grep -oP 'GET \K[^\s]+' | sort | uniq -c | sort -rn

# Count mobile vs desktop usage
fly logs --app talviliiga --no-tail | grep "📊" | grep -i "iphone\|android\|mobile" | wc -l
```

### Example Log Output

```
📊 [2025-11-13T11:26:24.459Z] GET / - IP: 192.168.1.1 - UA: Mozilla/5.0 (iPhone...)
📊 [2025-11-13T11:26:27.597Z] GET /base-team/Ajax%20P10 - IP: 192.168.1.1 - UA: Mozilla/5.0...
📊 [2025-11-13T11:26:30.168Z] GET /team/Ajax%20P10%20Keltainen?date=16.11 - IP: 192.168.1.2 - UA: Mozilla/5.0...
```

Each log entry shows:
- **Timestamp**: When the request was made
- **URL**: Which page was visited
- **IP**: Visitor's IP address (first part only)
- **User Agent**: Browser/device information (truncated)

## 🙏 Acknowledgments

Built using simplified patterns from the OLS Viikkopelit app, focusing on performance and simplicity for static tournament schedules.
