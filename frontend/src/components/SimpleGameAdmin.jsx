import { useControllerLease } from '../hooks/useControllerLease.js';
import { useGameSnapshot } from '../hooks/useGames.js';
import { SimpleGameWorkspace } from './SimpleGameWorkspace.jsx';

/** Settings use a stable draft; independent live polling never replaces text the operator is typing. */
export function SimpleGameAdmin({ session, gameId }) {
  const { query, install, saved } = useGameSnapshot(session, gameId);
  const view = useControllerLease(session, gameId, { autoAcquire: true });
  return <>
    {query.isPending && <p role="status">Loading settings…</p>}
    {(query.isError || view.query.isError) && <div role="alert" className="auth-error">
      <p>{(query.error || view.query.error).message}</p>
      <button type="button" onClick={() => { query.refetch(); view.reload(); }}>Reload game</button>
    </div>}
    {query.isSuccess && <SimpleGameWorkspace key={`${gameId}:${query.dataUpdatedAt}`} session={session}
      snapshot={query.data} install={install} reload={query.refetch} saved={saved} view={view} />}
  </>;
}
