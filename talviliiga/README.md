# Talviliiga

Unofficial schedule viewer for Tervarit Juniorit's Talviliiga 4v4 and 5v5 tournaments.
Bun + EJS, same architecture as `ols-viikkopelitv2`.

## Data source

The public Google Sheet linked from
https://sites.google.com/tervaritjuniorit.fi/talviliiga/etusivu ("4v4&5v5>>"),
downloaded as xlsx (`src/fetcher.ts`). For a new season, set `SHEET_ID`.

`src/parser.ts` reads:

- **Ilmoittautuneet joukkueet**: series, registered teams, game days ("Pelipäivät") and kiosk team.
  This is the source of truth for upcoming tournament days.
- **5v5 turnaukset / 4v4 turnaukset**: per-day schedule blocks (time, field, teams).
  Blocks whose date falls outside the current season (leftovers from last season) and
  later duplicate copies of a day are skipped. Skipped blocks with games are listed on `/admin`.

## Refresh

No cron. When a request arrives and the data is older than `REFRESH_MINUTES` (default 15),
the sheet is fetched in the background. On first boot without data the fetch blocks startup.
Manual: `POST /api/refresh` or the button on `/admin`.

## Commands

```bash
bun install
bun run dev                       # http://localhost:3003
bun test                          # parser tests against test/fixtures/*.xlsx
bun run fetch data/talviliiga.xlsx
bun run parse data/talviliiga.xlsx
```

## Deploy (Fly.io)

```bash
fly volumes create talviliiga_data -a talviliiga -r arn -s 1   # once
fly deploy
```

`scripts/parsePdf.ts` is the old parser for OLS's own Talviliiga PDFs (last season); not wired in.
