/**
 * RacingToken: 2.5D round racing chip per PRD §7.2 & §7.6.
 *
 * Characteristics:
 * - Charcoal dark base (#101827) for high legibility independently of team color (AT-42, AT-51).
 * - Bold white code label (T1–T10).
 * - White inner outline and dark directional shadow for 2.5D physical token feel.
 * - Team rim color as secondary identity accent.
 * - Active variant enlarged with golden halo ring (AT-44).
 */
export function RacingToken({
  team = null,
  code = null,
  teamColor = null,
  active = false,
  size = null
}) {
  const tokenCode = team?.code || code;
  if (!tokenCode) return null;

  const color = team?.color || teamColor || '#6b7280';
  const name = team?.name || tokenCode;
  const classes = ['racing-chip', 'racing-token', active ? 'is-active' : ''].filter(Boolean).join(' ');

  const style = {
    borderColor: color,
    ...(size ? { width: size, height: size, fontSize: `calc(${size} * 0.45)` } : {})
  };

  return (
    <span
      className={classes}
      style={style}
      title={`${tokenCode} · ${name}`}
      aria-label={`${tokenCode} (${name})${active ? ' - Active Turn' : ''}`}
      data-team-code={tokenCode}
    >
      {tokenCode}
    </span>
  );
}

