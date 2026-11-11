import { RacingToken } from './RacingToken.jsx';

/**
 * Backward compatibility alias for RacingToken.
 * Implements 2.5D round racing chip per PRD §7.2.
 */
export function RacingChip(props) {
  return <RacingToken {...props} />;
}

export { RacingToken };
