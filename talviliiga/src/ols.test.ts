import { test, expect, describe } from 'bun:test';
import * as path from 'path';
import { parseOlsPage, parsePdfName, pickPdfs, parseOlsPdf, makeTeamMatcher } from './ols.ts';

const FIX = path.join(import.meta.dir, '../test/fixtures');
const page = parseOlsPage(await Bun.file(`${FIX}/ols-talviliiga-2026-11-15.html`).text());

describe('OLS page', () => {
  test('season, venue and game days', () => {
    expect(page.season).toBe('2026-27');
    expect(page.location).toBe('Pörhö Areena');
    expect(page.hours).toBe('9.00–19.00');
    expect(page.days).toEqual(['2026-11-21', '2026-12-05', '2027-01-16', '2027-02-13', '2027-03-20']);
  });

  test('series per age group and level', () => {
    expect(page.series.length).toBe(10);
    const u6ep = page.series.find(s => s.id === 'OLS 3v3 U6 (2021) EP')!;
    expect(u6ep.teams).toEqual(['OLS Belgia 21 Anderlecht', 'OLS Kreikka 21 AEK', 'OLS Ruotsi 21 AIK', 'OsPa P21']);
    const u8vp = page.series.find(s => s.id === 'OLS 4v4 U8 (2019) VP')!;
    expect(u8vp.teams.length).toBe(10);
    expect(u8vp.teams.at(-1)).toBe('Villan Pojat juniorit 2019');
    expect(u8vp.days.length).toBe(5);
  });

  test('no html leaks into team names', () => {
    expect(page.series.flatMap(s => s.teams).some(t => /[<>="]/.test(t))).toBe(false);
  });
});

describe('PDF discovery', () => {
  test('file name', () => {
    expect(parsePdfName('https://x/Talviliiga221125a.pdf')).toEqual({ date: '2025-11-22', revision: 1 });
    expect(parsePdfName('https://x/Talviliiga221125.pdf')).toEqual({ date: '2025-11-22', revision: 0 });
    expect(parsePdfName('https://x/Kenttakartta-talviliiga-25.11.pdf')).toBeNull();
  });

  test('newest revision of season days only', () => {
    const picked = pickPdfs([
      'https://ols.fi/wp-content/uploads/2026/04/Talviliiga110426a.pdf',   // last season
      'https://ols.fi/wp-content/uploads/2026/11/Talviliiga211126.pdf',
      'https://ols.fi/wp-content/uploads/2026/11/Talviliiga211126b.pdf',
      'https://ols.fi/wp-content/uploads/2026/11/Talviliiga211126a.pdf',
    ], page.days);
    expect(picked.map(p => p.url.split('/').pop())).toEqual(['Talviliiga211126b.pdf']);
  });
});

describe('team matcher', () => {
  const m = makeTeamMatcher(['OLS Kreikka 17 AEK', 'KKP Oranssi 2017', 'OLS Espanja 18 Barcelona', 'ONS 2017 Punainen']);
  test('drops OLS prefix', () => expect(m('Kreikka 17 AEK').name).toBe('OLS Kreikka 17 AEK'));
  test('word order and year', () => expect(m('KKP 2017 Oranssi').name).toBe('KKP Oranssi 2017'));
  test('small typo', () => expect(m('Espanja 18 Barelona').name).toBe('OLS Espanja 18 Barcelona'));
  test('unknown stays', () => expect(m('Ruotsi 19 Örebro')).toEqual({ name: 'Ruotsi 19 Örebro', matched: false }));
});

describe('schedule PDF (last season format)', async () => {
  const buf = new Uint8Array(await Bun.file(`${FIX}/ols-pdf/Talviliiga221125a.pdf`).arrayBuffer());
  const r = await parseOlsPdf(buf, { date: '2025-11-22', location: page.location, series: page.series });

  test('all games found', () => {
    expect(r.documentDate).toBe('2025-11-22');
    expect(r.games.length).toBe(102);
  });
  test('fields 1A–2D', () => {
    expect([...new Set(r.games.map(g => g.field))].sort())
      .toEqual(['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D'].map(f => `Kenttä ${f}`));
  });
  test('times and durations', () => {
    expect(r.games.every(g => /^\d{2}:\d{2}$/.test(g.time))).toBe(true);
    expect(new Set(r.games.map(g => g.gameDuration))).toEqual(new Set(['15 min', '20 min']));
  });
  test('short names mapped to registered teams', () => {
    expect(r.games.some(g => g.team1 === 'OLS Kreikka 17 AEK' || g.team2 === 'OLS Kreikka 17 AEK')).toBe(true);
  });
  test('game type from this season age groups', () => {
    const g = r.games.find(g => /\b20\b/.test(g.team1))!;
    expect(g.gameType).toBe('3v3');
  });
});
