import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  countUnreadMessages,
  getMessagingChangeConversationId,
  MessagingService,
} from '../business-logic/MessagingService.js';
import { CallService } from '../business-logic/CallService.js';
import { createMessagingSessionCache } from '../business-logic/MessagingSessionCache.js';
import { useAuth } from './AuthContext.jsx';

const REALTIME_REFRESH_DELAY_MS = 80;

const MessagingSessionContext = createContext(null);

function createFolderState() {
  return {
    items: [],
    loaded: false,
    loading: false,
    error: '',
  };
}

function createMessageState() {
  return {
    items: [],
    loaded: false,
    loading: false,
    error: '',
  };
}

function createSession(userId = null) {
  return {
    userId,
    folder: 'active',
    folders: {
      active: createFolderState(),
      archived: createFolderState(),
    },
    conversations: {},
    messages: {},
  };
}

function replaceConversationInFolders(folders, conversation) {
  return Object.fromEntries(Object.entries(folders).map(([folder, state]) => [
    folder,
    state.items.some((item) => item.id === conversation.id)
      ? { ...state, items: state.items.map((item) => item.id === conversation.id ? conversation : item) }
      : state,
  ]));
}

function removeConversationFromSession(current, conversationId) {
  const conversations = { ...current.conversations };
  const messages = { ...current.messages };
  delete conversations[conversationId];
  delete messages[conversationId];
  return {
    ...current,
    conversations,
    messages,
    folders: Object.fromEntries(Object.entries(current.folders).map(([folder, state]) => [
      folder,
      { ...state, items: state.items.filter((item) => item.id !== conversationId) },
    ])),
  };
}

export function MessagingSessionProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [session, setSession] = useState(() => createSession());
  const sessionRef = useRef(session);
  const activeUserIdRef = useRef(null);
  const draftsRef = useRef(createMessagingSessionCache());
  const inFlightRef = useRef(new Map());

  const commitSession = useCallback((updater) => {
    const nextSession = updater(sessionRef.current);
    sessionRef.current = nextSession;
    setSession(nextSession);
    return nextSession;
  }, []);

  const refreshConversations = useCallback(async (folder = sessionRef.current.folder) => {
    if (!userId || !['active', 'archived'].includes(folder)) return [];
    const requestKey = `folder:${userId}:${folder}`;
    const activeRequest = inFlightRef.current.get(requestKey);
    if (activeRequest) return activeRequest;

    const currentFolderState = sessionRef.current.folders[folder];
    if (!currentFolderState.loaded) {
      commitSession((current) => current.userId !== userId ? current : ({
        ...current,
        folders: {
          ...current.folders,
          [folder]: { ...current.folders[folder], loading: true, error: '' },
        },
      }));
    }

    const request = (async () => {
      try {
        const conversations = await MessagingService.listConversations(folder);
        if (activeUserIdRef.current !== userId) return [];
        commitSession((current) => {
          if (current.userId !== userId) return current;
          const conversationMap = { ...current.conversations };
          conversations.forEach((conversation) => { conversationMap[conversation.id] = conversation; });
          return {
            ...current,
            conversations: conversationMap,
            folders: {
              ...current.folders,
              [folder]: { items: conversations, loaded: true, loading: false, error: '' },
            },
          };
        });
        return conversations;
      } catch (error) {
        if (activeUserIdRef.current === userId) {
          commitSession((current) => current.userId !== userId ? current : ({
            ...current,
            folders: {
              ...current.folders,
              [folder]: {
                ...current.folders[folder],
                loading: false,
                error: error.message || 'Unable to load conversations.',
              },
            },
          }));
        }
        return [];
      } finally {
        if (inFlightRef.current.get(requestKey) === request) {
          inFlightRef.current.delete(requestKey);
        }
      }
    })();
    inFlightRef.current.set(requestKey, request);
    return request;
  }, [commitSession, userId]);

  const refreshConversation = useCallback(async (conversationId, { markRead = false } = {}) => {
    if (!userId || !conversationId) return null;
    const requestKey = `conversation:${userId}:${conversationId}`;
    const activeRequest = inFlightRef.current.get(requestKey);
    if (activeRequest) return activeRequest;

    const cachedMessages = sessionRef.current.messages[conversationId];
    const hasCachedConversation = Boolean(
      sessionRef.current.conversations[conversationId]
      && cachedMessages?.loaded,
    );
    if (!hasCachedConversation) {
      commitSession((current) => current.userId !== userId ? current : ({
        ...current,
        messages: {
          ...current.messages,
          [conversationId]: { ...(current.messages[conversationId] || createMessageState()), loading: true, error: '' },
        },
      }));
    }

    const request = (async () => {
      try {
        const conversation = await MessagingService.getConversation(conversationId);
        if (!conversation) {
          if (activeUserIdRef.current === userId) {
            draftsRef.current.clearDraft(conversationId);
            commitSession((current) => current.userId === userId
              ? removeConversationFromSession(current, conversationId)
              : current);
          }
          return null;
        }
        const [messages, calls] = await Promise.all([
          MessagingService.listMessages(conversationId),
          CallService.listConversationCalls(conversationId).catch(() => []),
        ]);
        const timeline = [
          ...messages.map((message) => ({
            ...message,
            itemType: 'message',
            sortAt: message.createdAt,
          })),
          ...calls,
        ].sort((first, second) => {
          const timeDifference = new Date(first.sortAt) - new Date(second.sortAt);
          return timeDifference || first.id.localeCompare(second.id);
        });
        if (activeUserIdRef.current !== userId) return null;
        commitSession((current) => {
          if (current.userId !== userId) return current;
          return {
            ...current,
            conversations: { ...current.conversations, [conversationId]: conversation },
            folders: replaceConversationInFolders(current.folders, conversation),
            messages: {
              ...current.messages,
              [conversationId]: { items: timeline, loaded: true, loading: false, error: '' },
            },
          };
        });
        if (markRead && activeUserIdRef.current === userId) {
          try {
            await MessagingService.markConversationRead(conversationId);
            commitSession((current) => {
              if (current.userId !== userId) return current;
              const currentConversation = current.conversations[conversationId];
              if (!currentConversation?.unreadCount) return current;
              const readConversation = { ...currentConversation, unreadCount: 0 };
              return {
                ...current,
                conversations: { ...current.conversations, [conversationId]: readConversation },
                folders: replaceConversationInFolders(current.folders, readConversation),
              };
            });
          } catch {
            // Realtime or the next explicit refresh will reconcile a failed
            // read-cursor update without clearing the visible unread badge.
          }
        }
        return conversation;
      } catch (error) {
        if (activeUserIdRef.current === userId) {
          commitSession((current) => {
            if (current.userId !== userId) return current;
            const previous = current.messages[conversationId] || createMessageState();
            return {
              ...current,
              messages: {
                ...current.messages,
                [conversationId]: {
                  ...previous,
                  loading: false,
                  error: error.message || 'Unable to load this conversation.',
                },
              },
            };
          });
        }
        return null;
      } finally {
        if (inFlightRef.current.get(requestKey) === request) {
          inFlightRef.current.delete(requestKey);
        }
      }
    })();
    inFlightRef.current.set(requestKey, request);
    return request;
  }, [commitSession, userId]);

  const setFolder = useCallback((folder) => {
    if (!['active', 'archived'].includes(folder)) return;
    commitSession((current) => ({ ...current, folder }));
  }, [commitSession]);

  const getDraft = useCallback((conversationId) => draftsRef.current.getDraft(conversationId), []);

  const saveDraft = useCallback((conversationId, draft) => {
    draftsRef.current.saveDraft(conversationId, draft);
  }, []);

  const clearDraft = useCallback((conversationId) => {
    draftsRef.current.clearDraft(conversationId);
  }, []);

  useEffect(() => {
    if (activeUserIdRef.current === userId) return;
    activeUserIdRef.current = userId;
    inFlightRef.current.clear();
    draftsRef.current.setActiveUser(userId);
    commitSession(() => createSession(userId));
  }, [commitSession, userId]);

  useEffect(() => {
    if (!userId) return;
    void refreshConversations('active');
  }, [refreshConversations, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let timerId = null;
    let refreshAll = false;
    const conversationIds = new Set();
    const flushChanges = () => {
      timerId = null;
      const current = sessionRef.current;
      const folders = ['active', 'archived'].filter((folder) => current.folders[folder].loaded);
      const affectedConversationIds = refreshAll
        ? Object.keys(current.messages).filter((id) => current.messages[id].loaded)
        : [...conversationIds].filter((id) => current.messages[id]?.loaded);
      refreshAll = false;
      conversationIds.clear();
      folders.forEach((folder) => { refreshConversations(folder); });
      affectedConversationIds.forEach((id) => { refreshConversation(id); });
    };
    const unsubscribe = MessagingService.subscribeToMessaging((change) => {
      const changedConversationId = getMessagingChangeConversationId(change);
      if (changedConversationId) conversationIds.add(changedConversationId);
      else refreshAll = true;
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(flushChanges, REALTIME_REFRESH_DELAY_MS);
    });
    return () => {
      if (timerId) window.clearTimeout(timerId);
      unsubscribe();
    };
  }, [refreshConversation, refreshConversations, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const refreshLoadedFolders = () => {
      const loadedFolders = ['active', 'archived']
        .filter((item) => sessionRef.current.folders[item].loaded);
      loadedFolders.forEach((item) => { void refreshConversations(item); });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshLoadedFolders();
    };
    window.addEventListener('focus', refreshLoadedFolders);
    document.addEventListener('visibilitychange', handleVisibility);

    const expiries = Object.values(session.conversations)
      .map((conversation) => conversation.effectiveExpiresAt)
      .filter((value) => value && new Date(value).getTime() > Date.now())
      .map((value) => new Date(value).getTime());
    const timerId = expiries.length
      ? window.setTimeout(refreshLoadedFolders, Math.min(...expiries) - Date.now() + 100)
      : null;
    return () => {
      window.removeEventListener('focus', refreshLoadedFolders);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timerId) window.clearTimeout(timerId);
    };
  }, [refreshConversations, session.conversations, userId]);

  const value = useMemo(() => ({
    folder: session.folder,
    folderState: session.folders[session.folder],
    unreadMessageCount: session.folders.active.loaded && !session.folders.active.error
      ? countUnreadMessages(session.folders.active.items)
      : 0,
    getConversation: (conversationId) => session.conversations[conversationId] || null,
    getMessagesState: (conversationId) => session.messages[conversationId] || createMessageState(),
    setFolder,
    refreshConversations,
    refreshConversation,
    getDraft,
    saveDraft,
    clearDraft,
  }), [
    clearDraft,
    getDraft,
    refreshConversation,
    refreshConversations,
    saveDraft,
    session,
    setFolder,
  ]);

  return <MessagingSessionContext.Provider value={value}>{children}</MessagingSessionContext.Provider>;
}

export function useMessagingSession() {
  const context = useContext(MessagingSessionContext);
  if (!context) throw new Error('useMessagingSession must be used within MessagingSessionProvider');
  return context;
}
