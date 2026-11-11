import { describe, it, expect } from 'vitest';
import { sanitizeCsvCell, formatCsvRow, generateGameCsv } from '../domain/csvExport.js';

describe('CSV Export Domain (G13 & Gate D-07b)', () => {
  describe('sanitizeCsvCell', () => {
    it('returns empty string for null and undefined', () => {
      expect(sanitizeCsvCell(null)).toBe('');
      expect(sanitizeCsvCell(undefined)).toBe('');
    });

    it('formats booleans as uppercase TRUE and FALSE', () => {
      expect(sanitizeCsvCell(true)).toBe('TRUE');
      expect(sanitizeCsvCell(false)).toBe('FALSE');
    });

    it('formats numbers as literal strings without quotes', () => {
      expect(sanitizeCsvCell(0)).toBe('0');
      expect(sanitizeCsvCell(42)).toBe('42');
      expect(sanitizeCsvCell(-15)).toBe('-15');
      expect(sanitizeCsvCell(3.14)).toBe('3.14');
    });

    it('escapes commas, quotes, and newlines according to RFC 4180', () => {
      expect(sanitizeCsvCell('Hello, world')).toBe('"Hello, world"');
      expect(sanitizeCsvCell('Team "Apex"')).toBe('"Team ""Apex"""');
      expect(sanitizeCsvCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
      expect(sanitizeCsvCell('Line 1\r\nLine 2')).toBe('"Line 1\r\nLine 2"');
    });

    it('sanitizes formula injection triggers by prepending single quote', () => {
      // Formula triggers: =, +, -, @, \t, \r
      expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
      expect(sanitizeCsvCell('+cmd|/C calc')).toBe('"\' +cmd|/C calc"'.replace(' ', ''));
      expect(sanitizeCsvCell('-2+3+cmd')).toBe('"\' -2+3+cmd"'.replace(' ', ''));
      expect(sanitizeCsvCell('@dangerous')).toBe('"\'@dangerous"');
      expect(sanitizeCsvCell('\ttabbed')).toBe('"\'\ttabbed"');
    });

    it('preserves Unicode characters accurately', () => {
      expect(sanitizeCsvCell('Scuderia Ferrari 🏎️')).toBe('Scuderia Ferrari 🏎️');
      expect(sanitizeCsvCell('Poin Sukses: Berhasil & Unggul!')).toBe('Poin Sukses: Berhasil & Unggul!');
    });
  });

  describe('formatCsvRow', () => {
    it('joins multiple cells with commas', () => {
      const row = formatCsvRow([1, 'T1', 'Ferrari', 50, true]);
      expect(row).toBe('1,T1,Ferrari,50,TRUE');
    });

    it('properly quotes cells with special characters within row', () => {
      const row = formatCsvRow([1, 'T2', 'Red Bull, Racing', 50, false]);
      expect(row).toBe('1,T2,"Red Bull, Racing",50,FALSE');
    });
  });

  describe('generateGameCsv', () => {
    const game = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Grand Prix Final 2026',
      status: 'FINISHED',
      turnNumber: 12
    };

    const standings = [
      { rank: 1, code: 'T1', name: 'Ferrari', totalScore: 100, position: 50, isWinner: true },
      { rank: 1, code: 'T2', name: 'Red Bull', totalScore: 100, position: 48, isWinner: true },
      { rank: 3, code: 'T3', name: 'Mercedes', totalScore: 75, position: 35, isWinner: false },
      { rank: 4, code: 'T4', name: '=InjectFormula', totalScore: 50, position: 20, isWinner: false }
    ];

    const turns = [
      {
        turnNumber: 1,
        teamCode: 'T1',
        teamName: 'Ferrari',
        diceValue: 4,
        fromPosition: 0,
        landingCell: 4,
        finalPosition: 4,
        status: 'COMPLETED',
        scoringMethod: 'BUTTON',
        outcome: 'SUCCESS',
        awardedPoints: 15,
        note: 'Bagus',
        createdAt: '2026-11-10T10:00:00.000Z'
      }
    ];

    const scoreLedger = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        createdAt: '2026-11-10T10:01:00.000Z',
        teamCode: 'T1',
        teamName: 'Ferrari',
        deltaPoints: 15,
        source: 'CHALLENGE_BUTTON',
        reason: 'Giliran pertama',
        actorEmail: 'admin@f1.test',
        compensatesEntryId: null
      }
    ];

    it('generates multi-section CSV with UTF-8 BOM when scope=all', () => {
      const csv = generateGameCsv({ game, standings, turns, scoreLedger, scope: 'all' });
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('# GAME SUMMARY');
      expect(csv).toContain('Grand Prix Final 2026');
      expect(csv).toContain('[STANDINGS]');
      expect(csv).toContain('Rank,Team Code,Team Name,Total Score,Track Position,Is Winner');
      // Co-winners both rank 1
      expect(csv).toContain('1,T1,Ferrari,100,50,TRUE');
      expect(csv).toContain('1,T2,Red Bull,100,48,TRUE');
      // Skipped rank 2 -> rank 3
      expect(csv).toContain('3,T3,Mercedes,75,35,FALSE');
      // Formula sanitized
      expect(csv).toContain('4,T4,"\'=InjectFormula",50,20,FALSE');
      expect(csv).toContain('[TURN HISTORY]');
      expect(csv).toContain('1,T1,Ferrari,4,0,4,4,COMPLETED,BUTTON,SUCCESS,15,Bagus,2026-11-10T10:00:00.000Z');
      expect(csv).toContain('[SCORE LEDGER]');
      expect(csv).toContain('22222222-2222-4222-8222-222222222222,2026-11-10T10:01:00.000Z,T1,Ferrari,15,CHALLENGE_BUTTON');
    });

    it('generates pure standings table when scope=results or standings', () => {
      const csv = generateGameCsv({ game, standings, turns, scoreLedger, scope: 'results' });
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).not.toContain('# GAME SUMMARY');
      expect(csv).not.toContain('[STANDINGS]');
      const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
      expect(lines[0]).toBe('Rank,Team Code,Team Name,Total Score,Track Position,Is Winner');
      expect(lines[1]).toBe('1,T1,Ferrari,100,50,TRUE');
      expect(lines.length).toBe(5); // Header + 4 teams
    });

    it('generates pure turn history table when scope=turns', () => {
      const csv = generateGameCsv({ game, standings, turns, scoreLedger, scope: 'turns' });
      const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
      expect(lines[0]).toContain('Turn Number,Team Code,Team Name');
      expect(lines[1]).toContain('1,T1,Ferrari,4,0,4,4,COMPLETED');
    });

    it('generates pure score ledger table when scope=ledger', () => {
      const csv = generateGameCsv({ game, standings, turns, scoreLedger, scope: 'ledger' });
      const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
      expect(lines[0]).toContain('Entry ID,Timestamp,Team Code,Team Name,Delta Points,Source');
      expect(lines[1]).toContain('22222222-2222-4222-8222-222222222222');
    });
  });
});
