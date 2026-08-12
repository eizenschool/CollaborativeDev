import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { MessagingService } from '../../../business-logic/MessagingService.js';
import { IconMessage } from '../icons';
import ConversationList from './ConversationList';
import ChatWindow from './ChatWindow';
import TripInfoSidebar from './TripInfoSidebar';
import '../../styles/message.css';

const DESKTOP_BREAKPOINT = 900;

function getIsDesktop() {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.innerWidth > DESKTOP_BREAKPOINT;
}

function EmptyChatSelection() {
  return (
    <div className="message-empty-selection">
      <div className="message-empty-selection-icon">
        <IconMessage size={34} />
      </div>

      <h2>Select a conversation</h2>

      <p>
        Choose one of your ride or trip conversations from the
        list.
      </p>
    </div>
  );
}

export default function MessageModule() {
  const { user } = useAuth();
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [selectedConversationId, setSelectedConversationId] =
    useState(null);
  const [conversations, setConversations] = useState([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const refreshConversations = useCallback(async () => {
    if (!user) {
      setConversations([]);
      setIsLoading(false);
      return;
    }

    try {
      const nextConversations =
        await MessagingService.listConversations({ user });
      setConversations(nextConversations);
      setSelectedConversationId((currentId) =>
        currentId &&
        !nextConversations.some(
          (conversation) => conversation.id === currentId,
        )
          ? null
          : currentId,
      );
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations, dataVersion]);

  useEffect(() => {
    return MessagingService.subscribe(() => {
      setDataVersion((currentVersion) => currentVersion + 1);
    });
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(min-width: ${DESKTOP_BREAKPOINT + 1}px)`,
    );

    function handleViewportChange(event) {
      setIsDesktop(event.matches);
    }

    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleViewportChange);

    return () => {
      mediaQuery.removeEventListener('change', handleViewportChange);
    };
  }, []);

  function handleSelectConversation(conversationId) {
    setSelectedConversationId(conversationId);
  }

  function handleBackToConversationList() {
    setSelectedConversationId(null);
  }

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  );

  const conversationList = (
    <ConversationList
      conversations={conversations}
      currentUserId={user?.id}
      selectedConversationId={selectedConversationId}
      onSelectConversation={handleSelectConversation}
      isLoading={isLoading}
    />
  );

  if (isDesktop) {
    return (
      <main className="message-module message-module-desktop">
        <section className="message-desktop-conversation-column">
          {conversationList}
        </section>

        <section className="message-desktop-chat-column">
          {selectedConversationId ? (
            <ChatWindow
              conversationId={selectedConversationId}
              currentUser={user}
              dataVersion={dataVersion}
              onBack={handleBackToConversationList}
              isDesktop
            />
          ) : (
            <EmptyChatSelection />
          )}
        </section>

        <section className="message-desktop-info-column">
          <TripInfoSidebar
            conversation={selectedConversation}
            currentUserId={user?.id}
          />
        </section>
      </main>
    );
  }

  return (
    <main className="message-module message-module-mobile">
      {selectedConversationId ? (
        <ChatWindow
          conversationId={selectedConversationId}
          currentUser={user}
          dataVersion={dataVersion}
          onBack={handleBackToConversationList}
          isDesktop={false}
        />
      ) : (
        conversationList
      )}
    </main>
  );
}
