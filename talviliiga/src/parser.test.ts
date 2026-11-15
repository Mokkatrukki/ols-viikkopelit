import { test, expect, describe } from 'bun:test';
import * as path from 'path';
import { parseFile, cellToDate } from './parser.ts';

const data = parseFile(path.join(import.meta.dir, '../test/fixtures/talviliiga-2026-11-15.xlsx'));

describe('cellToDate', () => {
  test('excel serial', () => expect(cellToDate(46340)).toBe('2026-11-14'));
  test('text with weekday', () => expect(cellToDate('Sat 9.1.2027')).toBe('2027-01-09'));
  test('not a date', () => expect(cellToDate('Kempele Areena')).toBeNull());
});

describe('series (Ilmoittautuneet joukkueet)', () => {
  test('season', () => expect(data.season).toBe('2026-27'));
  test('all 5v5 and 4v4 series found', () => {
    expect(data.series.filter(s => s.gameType === '5v5').length).toBe(12);
    expect(data.series.filter(s => s.gameType === '4v4').length).toBe(6);
  });
  test('P10 EP teams and days', () => {
    const s = data.series.find(s => s.id === 'Pojat 5v5 P10 (2017) Taso 1 (EP)')!;
    expect(s.location).toBe('Kempele Areena');
    expect(s.teams).toContain('Tervarit 17 Musta');
    expect(s.teams).not.toContain('täynnä');
    expect(s.teams.length).toBe(14);
    expect(s.days.map(d => d.date)).toEqual(['2026-11-15', '2027-01-10', '2027-02-07', '2027-03-21', '2027-04-18']);
    expect(s.days[1].kiosk).toBe('Tervarit');
  });
  test('4v4 P7 days include serial-formatted 19.12.', () => {
    const s = data.series.find(s => s.id === 'Pojat 4v4 P7 (2020) Taso 1 (EP)')!;
    expect(s.location).toBe('Kurikkahaantien halli');
    expect(s.days.map(d => d.date)).toContain('2026-12-19');
    expect(s.days.length).toBe(6);
  });
});

describe('games (schedule sheets)', () => {
  const count = (date: string, type: string) => data.games.filter(g => g.date === date && g.gameType === type).length;

  test('published days parsed', () => {
    expect(count('2026-11-14', '5v5')).toBe(90);
    expect(count('2026-11-15', '5v5')).toBe(41);
    expect(count('2026-11-07', '4v4')).toBe(15);
    expect(count('2026-11-14', '4v4')).toBe(20);
  });

  test('stale last-season blocks are dropped', () => {
    expect(data.games.every(g => g.date >= '2026-10-01')).toBe(true);
    expect(data.warnings.some(w => w.includes('2026-04-18'))).toBe(true);
  });

  test('duplicate copies of a day are not double counted', () => {
    const keys = data.games.map(g => `${g.date}|${g.time}|${g.field}|${g.gameType}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('game shape', () => {
    const g = data.games.find(g => g.date === '2026-11-14' && g.time === '08:30' && g.field === 'Kenttä 1')!;
    expect(g).toMatchObject({
      location: 'Kempele Areena', gameType: '5v5', gameDuration: '25 min',
      team1: 'Ajax P18 Valkoinen', team2: 'Ospa P1819 Valkoinen',
    });
  });

  test('instruction text is not parsed as teams', () => {
    expect(data.games.some(g => /tötsät|aloittavat/i.test(g.team1 + g.team2))).toBe(false);
  });
});

describe('tournament days', () => {
  test('upcoming days listed without published games', () => {
    const d = data.days.find(d => d.date === '2027-01-09' && d.gameType === '5v5')!;
    expect(d.gamesPublished).toBe(0);
    expect(d.series.length).toBe(10);
  });
  test('22 days in season', () => expect(data.days.length).toBe(22));
});
