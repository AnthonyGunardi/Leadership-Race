/**
 * Pure domain logic for CSV serialization, escaping, and formula injection sanitization.
 *
 * Rules:
 * - Conforms to RFC 4180: fields with commas, quotes, or newlines are wrapped in double quotes.
 * - Internal quotes are escaped as double-quotes ("").
 * - Formula injection protection (CWE-1236): any string field starting with '=', '+', '-', '@', '\t', or '\r'
 *   is prefixed with a single quote (') so spreadsheet engines do not execute active content.
 * - Raw database content is never modified; sanitization applies only to the serialized CSV representation.
 * - Outputs UTF-8 with BOM (\uFEFF) for broad compatibility with Microsoft Excel and spreadsheet tools.
 */

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Sanitizes and escapes a single value for safe inclusion in an RFC 4180 CSV cell.
 *
 * @param {unknown} value Raw value to serialize.
 * @returns {string} Sanitized and escaped CSV cell representation.
 */
export function sanitizeCsvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  const str = String(value);

  // Formula injection prevention (CWE-1236)
  let safeStr = str;
  if (str.length > 0 && FORMULA_TRIGGERS.has(str[0])) {
    safeStr = `'${str}`;
  }

  // RFC 4180 escaping
  if (/[",\r\n]/.test(safeStr) || safeStr.startsWith("'")) {
    return `"${safeStr.replace(/"/g, '""')}"`;
  }

  return safeStr;
}

/**
 * Formats an array of cell values into a single RFC 4180 CSV line.
 *
 * @param {Array<unknown>} cells Values for each column.
 * @returns {string} Comma-separated escaped row.
 */
export function formatCsvRow(cells) {
  return cells.map(sanitizeCsvCell).join(',');
}

/**
 * Generates structured CSV content for a game according to the requested scope.
 *
 * Scopes:
 * - 'standings' / 'results': Only the ranked team standings table.
 * - 'turns': Only the turn-by-turn history table.
 * - 'ledger': Only the score ledger transaction table.
 * - 'all' (default): Multi-section report with summary, standings, turns, and score ledger.
 *
 * @param {object} params Export parameters.
 * @param {object} params.game Game header metadata.
 * @param {Array<object>} params.standings Ranked standings list.
 * @param {Array<object>} [params.turns] Turn history list.
 * @param {Array<object>} [params.scoreLedger] Score ledger list.
 * @param {string} [params.scope] Export scope ('all', 'standings', 'results', 'turns', 'ledger').
 * @param {string} [params.exportedAt] ISO timestamp string for export metadata.
 * @returns {string} Serialized CSV text prefixed with UTF-8 BOM.
 */
export function generateGameCsv({
  game,
  standings = [],
  turns = [],
  scoreLedger = [],
  scope = 'all',
  exportedAt = new Date().toISOString()
}) {
  const lines = [];

  const standingsHeaders = ['Rank', 'Team Code', 'Team Name', 'Total Score', 'Track Position', 'Is Winner'];
  const standingsRows = standings.map((item) => [
    item.rank,
    item.code,
    item.name,
    item.totalScore,
    item.position,
    Boolean(item.isWinner)
  ]);

  const turnsHeaders = [
    'Turn Number',
    'Team Code',
    'Team Name',
    'Dice Value',
    'From Position',
    'Landing Cell',
    'Final Position',
    'Status',
    'Scoring Method',
    'Outcome',
    'Awarded Points',
    'Note',
    'Timestamp'
  ];
  const turnsRows = turns.map((turn) => [
    turn.turnNumber,
    turn.teamCode,
    turn.teamName,
    turn.diceValue,
    turn.fromPosition,
    turn.landingCell,
    turn.finalPosition,
    turn.status,
    turn.scoringMethod ?? '',
    turn.outcome ?? '',
    turn.awardedPoints ?? 0,
    turn.note ?? '',
    turn.createdAt ?? ''
  ]);

  const ledgerHeaders = [
    'Entry ID',
    'Timestamp',
    'Team Code',
    'Team Name',
    'Delta Points',
    'Source',
    'Reason',
    'Actor',
    'Compensates Entry ID'
  ];
  const ledgerRows = scoreLedger.map((entry) => [
    entry.id,
    entry.createdAt ?? '',
    entry.teamCode,
    entry.teamName,
    entry.deltaPoints,
    entry.source,
    entry.reason ?? '',
    entry.actorEmail ?? '',
    entry.compensatesEntryId ?? ''
  ]);

  if (scope === 'standings' || scope === 'results') {
    lines.push(formatCsvRow(standingsHeaders));
    for (const row of standingsRows) {
      lines.push(formatCsvRow(row));
    }
  } else if (scope === 'turns') {
    lines.push(formatCsvRow(turnsHeaders));
    for (const row of turnsRows) {
      lines.push(formatCsvRow(row));
    }
  } else if (scope === 'ledger') {
    lines.push(formatCsvRow(ledgerHeaders));
    for (const row of ledgerRows) {
      lines.push(formatCsvRow(row));
    }
  } else {
    // scope === 'all'
    lines.push('# GAME SUMMARY');
    lines.push(formatCsvRow(['Game Name', game?.name ?? '']));
    lines.push(formatCsvRow(['Game ID', game?.id ?? '']));
    lines.push(formatCsvRow(['Status', game?.status ?? '']));
    lines.push(formatCsvRow(['Turn Number', game?.turnNumber ?? 0]));
    lines.push(formatCsvRow(['Exported At', exportedAt]));
    lines.push('');

    lines.push('[STANDINGS]');
    lines.push(formatCsvRow(standingsHeaders));
    for (const row of standingsRows) {
      lines.push(formatCsvRow(row));
    }
    lines.push('');

    lines.push('[TURN HISTORY]');
    lines.push(formatCsvRow(turnsHeaders));
    for (const row of turnsRows) {
      lines.push(formatCsvRow(row));
    }
    lines.push('');

    lines.push('[SCORE LEDGER]');
    lines.push(formatCsvRow(ledgerHeaders));
    for (const row of ledgerRows) {
      lines.push(formatCsvRow(row));
    }
  }

  // Prefix with UTF-8 BOM (\uFEFF)
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

