import { test, expect, describe, beforeAll } from 'bun:test';
import { parsePdf } from './parser.ts';
import type { GamesData } from './parser.ts';
import * as path from 'path';

const PDF_PATH = path.join(import.meta.dir, '../data/viikkopelit-7_5_2026.pdf');

let data: GamesData;

beforeAll(async () => {
  data = await parsePdf(PDF_PATH, 'https://example.com/Viikkopelit-7_5_2026.pdf');
});

describe('document metadata', () => {
  test('parses date correctly', () => {
    expect(data.documentDate).toBe('07.05.2026');
  });

  test('has games', () => {
    expect(data.games.length).toBeGreaterThan(50);
  });

  test('has one game day', () => {
    expect(data.gamesByDate.length).toBe(1);
    expect(data.gamesByDate[0].date).toBe('7.5');
    expect(data.gamesByDate[0].fullDate).toBe('07.05.2026');
  });

  test('stores pdfUrl', () => {
    expect(data.pdfUrl).toContain('Viikkopelit-7_5_2026.pdf');
  });
});

describe('field detection', () => {
  const expectedFields = [
    'PÖRHÖ AREENA 1A', 'PÖRHÖ AREENA 1B',
    'PÖRHÖ AREENA 1C', 'PÖRHÖ AREENA 1D',
    'PÖRHÖ AREENA 2A', 'PÖRHÖ AREENA 2B',
    'PÖRHÖ AREENA 2C', 'PÖRHÖ AREENA 2D',
    'HEINÄPÄÄN TEKONURMI A', 'HEINÄPÄÄN TEKONURMI B',
    'HEINÄPÄÄN TEKONURMI C', 'HEINÄPÄÄN TEKONURMI D',
  ];

  for (const field of expectedFields) {
    test(`has field: ${field}`, () => {
      const found = data.games.some(g => g.field === field);
      expect(found).toBe(true);
    });
  }

  test('no empty field names', () => {
    const empty = data.games.filter(g => !g.field.trim());
    expect(empty).toHaveLength(0);
  });
});

describe('team names', () => {
  test('no empty team names', () => {
    const bad = data.games.filter(g => !g.team1.trim() || !g.team2.trim());
    expect(bad).toHaveLength(0);
  });

  test('teams not equal', () => {
    const self = data.games.filter(g => g.team1 === g.team2);
    expect(self).toHaveLength(0);
  });

  test('known teams present', () => {
    const teams = new Set(data.games.flatMap(g => [g.team1, g.team2]));
    expect(teams.has('OLS Kreikka 19 Olympiakos')).toBe(true);
    expect(teams.has('OLS Ruotsi 17 AIK')).toBe(true);
    expect(teams.has('OLS Belgia 17 Anderlecht')).toBe(true);
    expect(teams.has('OLS Hollanti 19 PSV')).toBe(true);
  });
});

describe('game metadata', () => {
  test('no empty years', () => {
    const bad = data.games.filter(g => !g.year);
    expect(bad).toHaveLength(0);
  });

  test('years are 2017 or 2019', () => {
    const years = new Set(data.games.map(g => g.year));
    expect([...years].every(y => y === '2017' || y === '2019')).toBe(true);
  });

  test('2019 games are 3v3 15MIN', () => {
    const games2019 = data.games.filter(g => g.year === '2019');
    expect(games2019.length).toBeGreaterThan(0);
    for (const g of games2019) {
      expect(g.gameType).toBe('3 v 3');
      expect(g.gameDuration).toBe('15MIN');
    }
  });

  test('2017 games are 4v4 20MIN', () => {
    const games2017 = data.games.filter(g => g.year === '2017');
    expect(games2017.length).toBeGreaterThan(0);
    for (const g of games2017) {
      expect(g.gameType).toBe('4 v 4');
      expect(g.gameDuration).toBe('20MIN');
    }
  });

  test('valid time format HH:MM', () => {
    const bad = data.games.filter(g => !/^\d{2}:\d{2}$/.test(g.time));
    expect(bad).toHaveLength(0);
  });

  test('no empty locations', () => {
    const bad = data.games.filter(g => !g.location.trim());
    expect(bad).toHaveLength(0);
  });
});

describe('specific known games', () => {
  test('Kreikka 19 Olympiakos vs Ruotsi 19 AIK at 17:05 in 1A', () => {
    const found = data.games.find(g =>
      g.team1 === 'OLS Kreikka 19 Olympiakos' &&
      g.team2 === 'OLS Ruotsi 19 AIK' &&
      g.time === '17:05' &&
      g.field === 'PÖRHÖ AREENA 1A'
    );
    expect(found).toBeDefined();
  });

  test('Belgia 19 Genk vs ONS 2018 Musta at 17:05 in 1B', () => {
    const found = data.games.find(g =>
      g.team1 === 'OLS Belgia 19 Genk' &&
      g.team2 === 'ONS 2018 Musta' &&
      g.time === '17:05' &&
      g.field === 'PÖRHÖ AREENA 1B'
    );
    expect(found).toBeDefined();
  });

  test('Ruotsi 17 AIK vs Hollanti 17 Ajax at 16:45 in HEINÄPÄÄN A', () => {
    const found = data.games.find(g =>
      g.team1 === 'OLS Ruotsi 17 AIK' &&
      g.team2 === 'OLS Hollanti 17 Ajax' &&
      g.time === '16:45' &&
      g.field === 'HEINÄPÄÄN TEKONURMI A'
    );
    expect(found).toBeDefined();
  });
});

describe('no duplicate games', () => {
  test('no exact duplicates', () => {
    const keys = data.games.map(g =>
      `${g.date}|${g.time}|${g.field}|${g.team1}|${g.team2}`
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(data.games.length);
  });
});
