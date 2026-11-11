import { randomUUID } from 'node:crypto';
import { defineGameSetup } from '../../models/gameSetup.js';
import { getGameSnapshot } from '../../services/gameSetup.js';
import { assertSafeTestSchema } from '../../config/database.js';

/** Repeated scenarios use the real operational reset rather than the retired create/duplicate APIs. */
export async function prepareTestSession(request, name) {
  const current = await request('/current', { method: 'POST', body: { name } });
  if (current.status !== 200) throw new Error(`Current game failed: ${current.status}`);
  const { game, teams } = current.body.data;
  if (game.status === 'DRAFT' && teams.length === 0 && current.body.meta.stateVersion === 1) return current;
  const reset = await request(`/${game.id}/reset`, { method: 'POST', body: {
    expectedStateVersion: current.body.meta.stateVersion, confirmed: true
  } });
  if (reset.status !== 200) throw new Error(`Test session reset failed: ${JSON.stringify(reset.body.error)}`);
  return reset;
}

/** Represents records already present at upgrade, without exposing a second-game creation API. */
export async function storedGameFixture(sequelize, name) {
  assertSafeTestSchema(sequelize.config.database);
  const game = await defineGameSetup(sequelize).Game.create({ id: randomUUID(), name });
  return { status: 200, body: await getGameSnapshot({ sequelize, gameId: game.id }) };
}
