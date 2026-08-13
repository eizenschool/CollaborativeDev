function defaultReleasePreviewUrl(previewUrl) {
  if (previewUrl && globalThis.URL?.revokeObjectURL) {
    globalThis.URL.revokeObjectURL(previewUrl);
  }
}

function normalizeDraft(draft = {}) {
  return {
    text: draft.text || '',
    mediaEntries: Array.isArray(draft.mediaEntries) ? draft.mediaEntries : [],
    location: draft.location || null,
    editingMessage: draft.editingMessage || null,
  };
}

export function hasMessageDraftContent(draft) {
  return Boolean(
    draft?.text?.trim()
    || draft?.mediaEntries?.length
    || draft?.location
    || draft?.editingMessage,
  );
}

function releaseRemovedMedia(previousEntries, nextEntries, releasePreviewUrl) {
  const nextTokens = new Set(nextEntries.map((entry) => entry.token));
  previousEntries.forEach((entry) => {
    if (entry.source === 'new' && !nextTokens.has(entry.token)) {
      releasePreviewUrl(entry.previewUrl);
    }
  });
}

/**
 * Keeps unsent message bundles in memory for one signed-in browser session.
 * File objects deliberately remain in memory and are never persisted or uploaded.
 */
export function createMessagingSessionCache({ releasePreviewUrl = defaultReleasePreviewUrl } = {}) {
  let activeUserId = null;
  const drafts = new Map();

  function clearDraft(conversationId) {
    const existing = drafts.get(conversationId);
    if (!existing) return false;
    releaseRemovedMedia(existing.mediaEntries, [], releasePreviewUrl);
    drafts.delete(conversationId);
    return true;
  }

  return {
    setActiveUser(userId) {
      const nextUserId = userId || null;
      if (nextUserId === activeUserId) return false;
      [...drafts.keys()].forEach(clearDraft);
      activeUserId = nextUserId;
      return true;
    },

    getDraft(conversationId) {
      return drafts.get(conversationId) || null;
    },

    saveDraft(conversationId, draft) {
      const nextDraft = normalizeDraft(draft);
      if (!conversationId) return false;
      if (!hasMessageDraftContent(nextDraft)) return clearDraft(conversationId);
      const previousDraft = drafts.get(conversationId);
      if (previousDraft) {
        releaseRemovedMedia(previousDraft.mediaEntries, nextDraft.mediaEntries, releasePreviewUrl);
      }
      drafts.set(conversationId, nextDraft);
      return true;
    },

    clearDraft,

    clearAll() {
      const hadDrafts = drafts.size > 0;
      [...drafts.keys()].forEach(clearDraft);
      return hadDrafts;
    },
  };
}
