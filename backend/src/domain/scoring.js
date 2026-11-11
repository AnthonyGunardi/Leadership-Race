/**
 * Pure domain logic for scoring and leaderboard ranking.
 *
 * Requirements:
 * - Stable sort order: totalScore DESC, sortOrder ASC.
 * - sortOrder is strictly for deterministic presentation; it is NEVER a tie-breaker for rank or winners.
 * - Standard competition ranking: tied scores share the same rank; subsequent rank skips accordingly.
 * - Highest score tie results in shared rank 1 (co-winners).
 *
 * @param {Array<object>} teams List of team records.
 * @returns {Array<object>} Ranked leaderboard entries.
 */
export function calculateLeaderboard(teams = []) {
  const normalized = teams.map((team) => ({
    teamId: team.id || team.teamId,
    name: team.name,
    code: team.code || `T${team.sortOrder}`,
    sortOrder: Number(team.sortOrder),
    position: Number(team.position ?? 0),
    totalScore: Number(team.totalScore ?? 0)
  }));

  const sorted = [...normalized].sort((a, b) => (
    b.totalScore - a.totalScore || a.sortOrder - b.sortOrder
  ));

  let currentRank = 1;
  return sorted.map((team, index) => {
    if (index > 0 && team.totalScore < sorted[index - 1].totalScore) {
      currentRank = index + 1;
    }
    return {
      ...team,
      rank: currentRank
    };
  });
}
