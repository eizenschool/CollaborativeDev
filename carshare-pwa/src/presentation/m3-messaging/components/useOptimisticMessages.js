import { useEffect, useMemo, useState } from 'react';

const keyOf = (item) => `${item.itemType || 'message'}:${item.id}`;
const EMPTY = {};

// Keep a pending result over realtime snapshots until the server confirms it.
export default function useOptimisticMessages(items, conversationId) {
  const [changes, setChanges] = useState({});
  const active = changes[conversationId] || EMPTY;
  const messages = useMemo(() => items.flatMap((item) => {
    const change = active[keyOf(item)];
    if (!change) return [item];
    return change.message ? [change.message] : [];
  }), [items, active]);

  useEffect(() => {
    setChanges((previous) => {
      const current = previous[conversationId];
      if (!current) return previous;
      const remaining = { ...current };
      for (const [key, change] of Object.entries(current)) {
        if (!change.settled) continue;
        const server = items.find((item) => keyOf(item) === key);
        // Personal deletion is confirmed only by absence, not a shared tombstone.
        if (!server || (change.message && server.deletedAt)
          || (change.message?.editedAt && server?.editedAt
            && new Date(server.editedAt) >= new Date(change.message.editedAt))) delete remaining[key];
      }
      return Object.keys(remaining).length === Object.keys(current).length
        ? previous : { ...previous, [conversationId]: remaining };
    });
  }, [items, conversationId, active]);

  function begin(item, message) {
    const scope = conversationId;
    const key = keyOf(item);
    const token = Symbol();
    setChanges((previous) => ({ ...previous, [scope]: { ...previous[scope], [key]: { token, message, settled: false } } }));
    function update(replace) {
      setChanges((previous) => {
        if (previous[scope]?.[key]?.token !== token) return previous;
        const next = { ...previous[scope] };
        if (replace) next[key] = replace(next[key]);
        else delete next[key];
        return { ...previous, [scope]: next };
      });
    }
    return {
      rollback: () => update(null),
      commit: (confirmed) => update((change) => ({ ...change, settled: true,
        message: change.message ? { ...(confirmed || change.message), pendingAction: null } : null,
      })),
    };
  }
  return { messages, begin };
}
