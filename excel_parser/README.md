# OLS Excel Tournament Parser

A standalone parser for converting Excel tournament schedules into the JSON format used by the OLS Viikkopelit application.

## Purpose

This parser is a separate, independent tool that reads Excel files containing tournament schedules (4v4 and 5v5 tournaments) and generates `extracted_games_output.json` in the same format as the existing PDF parser.

**Key Features:**
- Parses Excel files with tournament schedules
- Supports both "5v5 turnaukset" and "4v4 turnaukset" sheets
- Extracts date, location, time, teams, and field information
- Generates JSON compatible with the main OLS Viikkopelit viewer app
- Completely separate from the existing PDF parsing system

## Installation

```bash
cd excel_parser
npm install
```

## Usage

### Basic Usage

Parse the default Excel file (assumed to be in admin_app directory):
```bash
npm run parse
```

### Custom Input/Output Paths

Specify custom Excel file and output JSON path:
```bash
npm run parse path/to/excel-file.xlsx path/to/output.json
```

### Development Mode

Run with ts-node for immediate execution without build step:
```bash
npm run dev
```

## Excel Format Expected

The parser expects Excel files with the following structure:

### Sheet Names
- `5v5 turnaukset` - For 5v5 tournament games
- `4v4 turnaukset` - For 4v4 tournament games

### Data Format in Sheets

**Date and Location Header:**
```
15.11            Kempele Areena
                 PELIAIKA 25MIN
```

**Game Data Rows:**
```
Peliaika    Kenttä 1        Peliaika    Kenttä 2        Peliaika    Kenttä 3    ...
08:30       Team A          Team B      08:30           Team C      Team D      ...
09:00       Team E          Team F      09:00           Team G      Team H      ...
```

### Key Elements Extracted
- **Date**: From lines like "15.11" or "Sat 8.11.2025"
- **Location**: From lines like "Kempele Areena" or "Kurikkahaantien halli"
- **Game Duration**: From lines like "PELIAIKA 25MIN"
- **Time**: From time columns (e.g., "08:30", "09:00")
- **Teams**: Team names from columns following time
- **Field**: Identified by column position (Kenttä 1, Kenttä 2, etc.)
- **Year**: Extracted from team names (e.g., "Ajax P9" → 2009, "Tervarit 17" → 2017)

## Output Format

The parser generates JSON with the following structure:

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
    }
  ]
}
```

## Integration with Main App

This parser is designed to be **completely separate** from the existing PDF parsing system. However, the output JSON format is **identical** to what the main app expects.

### To Use With Main OLS Viikkopelit App:

1. Run the Excel parser to generate JSON:
   ```bash
   cd excel_parser
   npm run parse
   ```

2. Copy the generated JSON to the main app's data directory:
   ```bash
   cp output/extracted_games_output.json ../persistent_app_files/extracted_games_output.json
   ```

3. Restart the main app or trigger data reload from the admin panel

## Project Structure

```
excel_parser/
├── src/
│   └── excelParser.ts       # Main parsing logic
├── output/                   # Generated JSON files
│   └── extracted_games_output.json
├── package.json
├── tsconfig.json
└── README.md
```

## Development

### Build

Compile TypeScript to JavaScript:
```bash
npm run build
```

This creates compiled files in the `dist/` directory.

### Run Tests

After making changes, test the parser:
```bash
npm run parse
```

Check the output in `output/extracted_games_output.json` to verify the results.

## Notes

- **Separate System**: This parser does NOT modify or interfere with the existing PDF parsing system
- **Same Format**: Output JSON is compatible with the main OLS Viikkopelit viewer
- **Easy Integration**: Simply replace the `extracted_games_output.json` file to use Excel data instead of PDF data
- **Future-Proof**: Can be extended to support additional Excel formats or tournament types

## Troubleshooting

### "Excel file not found"
Make sure the Excel file path is correct. The default path is:
```
../admin_app/Talviliigan 2025-2026 Otteluohjelmat 4v4_5v5 .xlsx
```

### No games extracted
- Check that the Excel file has sheets named "5v5 turnaukset" or "4v4 turnaukset"
- Verify the Excel format matches the expected structure
- Look at console output for parsing details

### Invalid JSON output
- Check that teams, dates, and times are properly formatted in the Excel file
- Ensure there are no empty or malformed rows

## License

MIT
