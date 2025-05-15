# 🗺️ Project Plan: OLS Viikkopelit Viewer

## 📦 Stack Overview

- **Backend**: Express.js + TypeScript
- **Rendering**: Server-side rendered HTML using `ejs` or `pug`
- **Styling**: Tailwind CSS (compiled once)
- **PDF Parsing**: `pdf-parse`
- **Deployment**: Docker + Fly.io
- **Optional**: Upload PDF manually via a UI form

---

## 🧠 Key Features

### ✅ Team Schedule Viewer
- Dropdown: Choose your team (e.g. `OLS Belgia 19 Brugge`)
- Show:
  - Match time (e.g. `17.05 - 17.20`)
  - Opponent (e.g. `OLS Ruotsi 19 Malmö`)
  - Duration + Format (e.g. `15min, 3 vs 3`)
  - Field (e.g. `GARAM MASALA 2A`)
  - View field on map

### ✅ Admin PDF Upload (optional, no scraper at first)
- Form-based UI to upload the latest PDF
- Automatically parses and stores match data

---

## 📄 PDF Parser: Overview

### 📚 Library: `pdf-parse`
Install:
```bash
npm install pdf-parse