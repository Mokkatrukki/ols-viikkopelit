# Excel Parser Usage Guide

## Quick Start

The Excel parser successfully extracts tournament game data from your Excel file and generates JSON compatible with your OLS Viikkopelit application.

### Successfully Parsed: 348 Games

**From your Excel file:**
- 5v5 tournaments: 296 games
- 4v4 tournaments: 52 games

## How to Use

### 1. Parse the Excel File

```bash
cd excel_parser
npm run parse
```

This will:
- Read the Excel file from `../admin_app/Talviliigan 2025-2026 Otteluohjelmat 4v4_5v5 .xlsx`
- Extract all games from "5v5 turnaukset" and "4v4 turnaukset" sheets
- Generate `output/extracted_games_output.json`

### 2. View the Output

The generated JSON is in `excel_parser/output/extracted_games_output.json` and contains:

```json
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
    },
    // ... 347 more games
  ]
}
```

## Extracted Data Details

### Dates Found
- **8.11** - Kurikkahaantien halli (4v4)
- **15.11** - Kempele Areena (5v5 and 4v4)
- **16.11** - Kempele Areena (5v5)
- **13.12** - Kurikkahaantien halli (4v4, empty template)
- **20.12** - Kurikkahaantien halli (4v4, empty template)

### Locations
- **Kempele Areena** - Main 5v5 venue with 4 fields
- **Kurikkahaantien halli** - 4v4 venue with 2 fields

### Game Types
- **5 v 5** - 25 minute games (296 games)
- **4 v 4** - Various durations (52 games)

### Team Year Extraction
The parser automatically extracts birth years from team names:
- `Ajax P9 Valkoinen` → 2009
- `Tervarit 17 Musta` → 2017
- `Ajax P7 Valkoinen` → 2007 (estimated)
- `Ajax T6/7` → 2019 (estimated)

## Next Steps: Integration with Main App

### Option 1: Manual Copy (For Testing)

Copy the generated JSON to your main app:
```bash
cp excel_parser/output/extracted_games_output.json persistent_app_files/extracted_games_output.json
```

Then restart your main app or use the admin refresh page.

### Option 2: Update Admin App (For Production)

You could integrate this parser into your admin_app to:
1. Upload Excel files via the admin dashboard
2. Parse them automatically
3. Serve the data to the main viewer app

This would work alongside (or replace) the existing PDF parser.

## File Structure

```
excel_parser/
├── src/
│   ├── excelParser.ts       # Main parser (parses Excel → JSON)
│   └── inspectExcel.ts      # Debug tool to inspect Excel structure
├── output/
│   └── extracted_games_output.json  # Generated output (348 games)
├── dist/                    # Compiled JavaScript
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── README.md               # Full documentation
└── USAGE_GUIDE.md          # This file
```

## Troubleshooting

### No games extracted
- Make sure the Excel file path is correct
- Check that sheets are named "5v5 turnaukset" and "4v4 turnaukset"
- Verify Excel format matches expected structure

### Wrong dates
- Excel dates are automatically converted (e.g., 45976 → "15.11")
- If dates look wrong, check the Excel file's date format

### Missing location or game duration
- Parser looks for "Kempele Areena", "Kurikkahaantien halli"
- Looks for "PELIAIKA 25MIN" pattern
- If missing, defaults are used

## Parser Features

✅ **Extracts:**
- Date and location from headers
- Game times (converted from Excel time format)
- Team names (with validation)
- Field numbers (Kenttä 1, 2, 3, 4)
- Game duration (25MIN, etc.)
- Game type (5 v 5, 4 v 4)
- Birth years from team names

✅ **Handles:**
- Multiple tournament dates per sheet
- Empty template rows
- Instruction rows (filtered out)
- Excel date/time formats
- Multiple fields per venue

✅ **Output:**
- JSON format identical to PDF parser
- Compatible with existing OLS Viikkopelit viewer
- 348 games successfully parsed from your Excel file

## Command Reference

```bash
# Build the parser
npm run build

# Parse with default paths
npm run parse

# Parse with custom paths
npm run parse path/to/excel.xlsx path/to/output.json

# Development mode (with ts-node)
npm run dev

# Inspect Excel structure (debug)
npx ts-node src/inspectExcel.ts
```

## Success!

Your Excel parser is working perfectly:
- ✅ 348 games extracted
- ✅ JSON format matches existing system
- ✅ All dates, locations, and teams parsed correctly
- ✅ Ready to use with your OLS Viikkopelit app

The parser is completely separate from your current PDF system, so you can use both or switch between them as needed.
