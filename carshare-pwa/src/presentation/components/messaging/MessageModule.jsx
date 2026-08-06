import { useEffect, useState } from 'react';
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
  const [isDesktop, setIsDesktop] = useState(getIsDesktop);
  const [
    selectedConversationId,
    setSelectedConversationId,
  ] = useState(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(min-width: ${DESKTOP_BREAKPOINT + 1}px)`,
    );

    function handleViewportChange(event) {
      setIsDesktop(event.matches);
    }

    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener(
      'change',
      handleViewportChange,
    );

    return () => {
      mediaQuery.removeEventListener(
        'change',
        handleViewportChange,
      );
    };
  }, []);

  function handleSelectConversation(conversationId) {
    setSelectedConversationId(conversationId);
  }

  function handleBackToConversationList() {
    setSelectedConversationId(null);
  }

  if (isDesktop) {
    return (
      <main className="message-module message-module-desktop">
        <section className="message-desktop-conversation-column">
          <ConversationList
            selectedConversationId={
              selectedConversationId
            }
            onSelectConversation={
              handleSelectConversation
            }
            isCompact
          />
        </section>

        <section className="message-desktop-chat-column">
          {selectedConversationId ? (
            <ChatWindow
              conversationId={selectedConversationId}
              onBack={handleBackToConversationList}
              isDesktop
            />
          ) : (
            <EmptyChatSelection />
          )}
        </section>

        <section className="message-desktop-info-column">
          <TripInfoSidebar
            conversationId={selectedConversationId}
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
          onBack={handleBackToConversationList}
          isDesktop={false}
        />
      ) : (
        <ConversationList
          selectedConversationId={null}
          onSelectConversation={
            handleSelectConversation
          }
        />
      )}
    </main>
  );
}