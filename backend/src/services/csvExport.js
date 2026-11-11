import { defineGameSetup } from '../models/gameSetup.js';
import { defineTurn } from '../models/turn.js';
import { defineScoring } from '../models/scoring.js';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { calculateLeaderboard } from '../domain/scoring.js';
import { generateGameCsv } from '../domain/csvExport.js';
import { safeInteger } from './gameCommands.js';

/**
 * Service to generate RFC 4180 CSV export with formula injection sanitization.
 *
 * Requirements:
 * - Super Admin scoped, cross-game isolated.
 * - Respects standard competition ranking (Gate D-07b co-winners share rank 1; non-top ties skip ranks).
 * - Sanitizes cells starting with formula triggers (=, +, -, @, \t, \r) without altering stored DB data.
 * - Supports scopes: 'all', 'standings', 'results', 'turns', 'ledger', with optional teamId filter.
 *
 * @param {object} params Export parameters.
 * @param {import('sequelize').Sequelize} params.sequelize Active Sequelize instance.
 * @param {string} params.gameId Target game identifier.
 * @param {string} [params.scope='all'] Target export scope.
 * @param {string} [params.teamId] Optional team UUID filter.
 * @param {string} [params.requestId] Trace request ID.
 * @returns {Promise<{ csv: string, filename: string, game: object }>}
 */
export async function exportGameCsv({ sequelize, gameId, scope = 'all', teamId, requestId }) {
  const { Game, Team } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const { FinalResult, ChallengeResult, ScoreLedger } = defineScoring(sequelize);
  const { User } = defineAdminIdentity(sequelize);

  const game = await Game.findByPk(gameId);
  if (!game) {
    const error = new Error('Game tidak ditemukan.');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const teams = await Team.findAll({
    where: { gameId },
    order: [['sortOrder', 'ASC']]
  });

  const teamMap = new Map(teams.map((t) => [t.id, {
    id: t.id,
    name: t.name,
    code: `T${t.sortOrder}`,
    color: t.color,
    position: t.position,
    totalScore: safeInteger(t.totalScore),
    sortOrder: t.sortOrder
  }]));

  // Determine standings
  let standings = [];
  if (game.status === 'FINISHED') {
    const storedFinals = await FinalResult.findAll({
      where: { gameId },
      order: [['rank', 'ASC'], ['score', 'DESC']]
    });
    if (storedFinals.length > 0) {
      standings = storedFinals.map((r) => {
        const team = teamMap.get(r.teamId);
        return {
          rank: r.rank,
          code: team?.code ?? '',
          name: team?.name ?? '',
          totalScore: safeInteger(r.score),
          position: r.position,
          isWinner: Boolean(r.isWinner)
        };
      });
    }
  }

  if (standings.length === 0) {
    const leaderboard = calculateLeaderboard(teams.map((t) => ({
      id: t.id,
      name: t.name,
      code: `T${t.sortOrder}`,
      sortOrder: t.sortOrder,
      position: t.position,
      totalScore: safeInteger(t.totalScore)
    })));
    standings = leaderboard.map((item) => ({
      rank: item.rank,
      code: item.code,
      name: item.name,
      totalScore: item.totalScore,
      position: item.position,
      isWinner: item.rank === 1 && item.totalScore > 0
    }));
  }

  // Load turns if required
  let turns = [];
  if (scope === 'all' || scope === 'turns') {
    const turnWhere = { gameId };
    if (teamId) {
      turnWhere.teamId = teamId;
    }
    const turnRows = await Turn.findAll({
      where: turnWhere,
      order: [['turnNumber', 'ASC']]
    });

    const turnIds = turnRows.map((r) => r.id);
    const challengeResults = turnIds.length > 0
      ? await ChallengeResult.findAll({ where: { turnId: turnIds } })
      : [];
    const resultMap = new Map(challengeResults.map((cr) => [cr.turnId, cr]));

    turns = turnRows.map((t) => {
      const cr = resultMap.get(t.id);
      const teamInfo = teamMap.get(t.teamId);
      return {
        turnNumber: safeInteger(t.turnNumber),
        teamCode: teamInfo?.code ?? '',
        teamName: teamInfo?.name ?? '',
        diceValue: t.diceValue,
        fromPosition: t.fromPosition,
        landingCell: t.landingCell,
        finalPosition: t.finalPosition,
        status: t.status,
        scoringMethod: cr?.scoringMethod ?? null,
        outcome: cr?.outcome ?? null,
        awardedPoints: cr ? safeInteger(cr.awardedPoints) : 0,
        note: cr?.note ?? null,
        createdAt: t.createdAt ? t.createdAt.toISOString() : ''
      };
    });
  }

  // Load score ledger if required
  let scoreLedger = [];
  if (scope === 'all' || scope === 'ledger') {
    const ledgerWhere = { gameId };
    if (teamId) {
      ledgerWhere.teamId = teamId;
    }
    const ledgerRows = await ScoreLedger.findAll({
      where: ledgerWhere,
      order: [['createdAt', 'ASC']]
    });

    const actorUserIds = [...new Set(ledgerRows.map((l) => l.actorUserId).filter(Boolean))];
    let userMap = new Map();
    if (actorUserIds.length > 0 && User) {
      const users = await User.findAll({ where: { id: actorUserIds } });
      userMap = new Map(users.map((u) => [u.id, u.email]));
    }

    scoreLedger = ledgerRows.map((l) => {
      const teamInfo = teamMap.get(l.teamId);
      return {
        id: l.id,
        createdAt: l.createdAt ? l.createdAt.toISOString() : '',
        teamCode: teamInfo?.code ?? '',
        teamName: teamInfo?.name ?? '',
        deltaPoints: safeInteger(l.deltaPoints),
        source: l.source,
        reason: l.reason ?? '',
        actorEmail: userMap.get(l.actorUserId) ?? '',
        compensatesEntryId: l.compensatesEntryId ?? ''
      };
    });
  }

  const csv = generateGameCsv({
    game: {
      id: game.id,
      name: game.name,
      status: game.status,
      turnNumber: safeInteger(game.turnNumber)
    },
    standings,
    turns,
    scoreLedger,
    scope,
    exportedAt: new Date().toISOString()
  });

  const sanitizedGameName = (game.name || 'game')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 32);
  const filename = `leadership-race-${sanitizedGameName}-${game.id.slice(0, 8)}.csv`;

  return {
    csv,
    filename,
    game: { id: game.id, name: game.name, status: game.status },
    requestId
  };
}

