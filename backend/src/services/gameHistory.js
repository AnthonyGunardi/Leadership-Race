import { defineGameSetup } from '../models/gameSetup.js';
import { defineTurn } from '../models/turn.js';
import { defineAuthAudit } from '../models/authAudit.js';
import { defineScoring } from '../models/scoring.js';
import { defineAdminIdentity } from '../models/adminIdentity.js';
import { safeInteger } from './gameCommands.js';
import { defineSingleGame } from '../models/singleGame.js';

/**
 * Retrieves game turn history, score ledgers, and audit trails with team and category filtering.
 *
 * @param {object} params Execution parameters.
 * @param {import('sequelize').Sequelize} params.sequelize Sequelize instance.
 * @param {string} params.gameId Game identifier.
 * @param {object} [params.query={}] Query filter parameters.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function getGameHistory({ sequelize, gameId, query = {} }) {
  const { Game, Team } = defineGameSetup(sequelize);
  const Turn = defineTurn(sequelize);
  const { ChallengeResult, ScoreLedger } = defineScoring(sequelize);
  const { AuditLog } = defineAuthAudit(sequelize);
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
    totalScore: safeInteger(t.totalScore)
  }]));

  const filterType = query.type || 'all';
  const filterTeamId = query.teamId || null;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  let turns = [];
  let scoreLedger = [];
  let auditLogs = [];

  if (filterType === 'all' || filterType === 'turns') {
    const turnWhere = { gameId };
    if (filterTeamId) turnWhere.teamId = filterTeamId;

    const turnRows = await Turn.findAll({
      where: turnWhere,
      order: [['turnNumber', 'DESC']],
      limit,
      offset
    });

    const turnIds = turnRows.map((r) => r.id);
    const challengeResults = turnIds.length > 0 ? await ChallengeResult.findAll({
      where: { turnId: turnIds }
    }) : [];
    const resultMap = new Map(challengeResults.map((cr) => [cr.turnId, cr]));

    turns = turnRows.map((t) => {
      const cr = resultMap.get(t.id);
      const teamInfo = teamMap.get(t.teamId);
      return {
        id: t.id,
        turnNumber: safeInteger(t.turnNumber),
        teamId: t.teamId,
        teamName: teamInfo?.name || 'Unknown',
        teamCode: teamInfo?.code || '',
        teamColor: teamInfo?.color || '#000000',
        diceValue: t.diceValue,
        fromPosition: t.fromPosition,
        landingCell: t.landingCell,
        finalPosition: t.finalPosition,
        status: t.status,
        requiresChallenge: t.requiresChallenge,
        voidedAt: t.voidedAt ? t.voidedAt.toISOString() : null,
        voidReason: t.voidReason,
        createdAt: t.createdAt ? t.createdAt.toISOString() : null,
        resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
        challengeResult: cr ? {
          id: cr.id,
          scoringMethod: cr.scoringMethod,
          outcome: cr.outcome,
          awardedPoints: cr.awardedPoints,
          note: cr.note
        } : null
      };
    });
  }

  if (filterType === 'all' || filterType === 'ledger') {
    const ledgerWhere = { gameId };
    if (filterTeamId) ledgerWhere.teamId = filterTeamId;

    const ledgerRows = await ScoreLedger.findAll({
      where: ledgerWhere,
      order: [['createdAt', 'DESC']],
      limit,
      offset
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
        teamId: l.teamId,
        teamName: teamInfo?.name || 'Unknown',
        teamCode: teamInfo?.code || '',
        turnId: l.turnId,
        challengeResultId: l.challengeResultId,
        deltaPoints: l.deltaPoints,
        source: l.source,
        reason: l.reason,
        actorUserId: l.actorUserId,
        actorEmail: userMap.get(l.actorUserId) || null,
        compensatesEntryId: l.compensatesEntryId,
        createdAt: l.createdAt ? l.createdAt.toISOString() : null
      };
    });
  }

  if (filterType === 'all' || filterType === 'audit') {
    const auditWhere = { gameId };
    const auditRows = await AuditLog.findAll({
      where: auditWhere,
      order: [['occurredAt', 'DESC']],
      limit,
      offset
    });

    const actorUserIds = [...new Set(auditRows.map((a) => a.actorUserId).filter(Boolean))];
    let userMap = new Map();
    if (actorUserIds.length > 0 && User) {
      const users = await User.findAll({ where: { id: actorUserIds } });
      userMap = new Map(users.map((u) => [u.id, u.email]));
    }

    auditLogs = auditRows
      .filter((a) => {
        if (!filterTeamId) return true;
        const before = a.beforeJson || {};
        const after = a.afterJson || {};
        return before.teamId === filterTeamId || after.teamId === filterTeamId;
      })
      .map((a) => ({
        id: a.id,
        action: a.action,
        actorType: a.actorType,
        actorUserId: a.actorUserId,
        actorEmail: userMap.get(a.actorUserId) || (a.actorType === 'SYSTEM' ? 'SYSTEM' : null),
        before: a.beforeJson,
        after: a.afterJson,
        reason: a.reason,
        requestId: a.requestId,
        occurredAt: a.occurredAt ? a.occurredAt.toISOString() : null
      }));
  }

  return {
    success: true,
    data: {
      game: {
        id: game.id,
        name: game.name,
        status: game.status,
        isArchived: Boolean(await defineSingleGame(sequelize).GameArchive.findByPk(gameId)),
        stateVersion: safeInteger(game.stateVersion),
        turnNumber: safeInteger(game.turnNumber)
      },
      teams: Array.from(teamMap.values()),
      turns,
      scoreLedger,
      auditLogs
    }
  };
}
