import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessagingService } from '../../../business-logic/MessagingService.js';
import { IconArrowLeft, IconSearch, IconX } from '../icons.jsx';

function HighlightedText({ text = '', keyword = '' }) {
  const query = keyword.trim();
  if (!query) return text;
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const parts = [];
  let cursor = 0;
  let match = lowerText.indexOf(lowerQuery);
  while (match !== -1) {
    parts.push(text.slice(cursor, match));
    parts.push(<mark key={`${match}-${cursor}`}>{text.slice(match, match + query.length)}</mark>);
    cursor = match + query.length;
    match = lowerText.indexOf(lowerQuery, cursor);
  }
  parts.push(text.slice(cursor));
  return parts;
}

function HistoryMessage({ message, keyword, onOpen }) {
  const attachmentNames = message.attachments
    .filter((item) => item.fileName)
    .map((item) => item.fileName);
  return (
    <button type="button" className="message-history-result" onClick={() => onOpen(message.id)}>
      <div className="message-history-result-heading">
        <strong>{message.senderName}</strong>
        <span>{message.timestamp}</span>
      </div>
      {message.deletedAt ? <em>message deleted</em> : (
        <>
          {message.text && <p><HighlightedText text={message.text} keyword={keyword} /></p>}
          {attachmentNames.map((name) => <small key={name}><HighlightedText text={name} keyword={keyword} /></small>)}
          {message.messageTypes.includes('location') && <small>Shared location</small>}
          <div className="message-history-types">
            {message.messageTypes.map((type) => <span key={type}>{type}</span>)}
            {message.editedAt && <span>edited</span>}
          </div>
        </>
      )}
    </button>
  );
}

export default function MessageHistory({ conversationId, onBack, onOpenMessage }) {
  const [conversation, setConversation] = useState(null);
  const [allMessages, setAllMessages] = useState([]);
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [searchError, setSearchError] = useState('');

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [nextConversation, messages] = await Promise.all([
        MessagingService.getConversation(conversationId),
        MessagingService.listMessages(conversationId),
      ]);
      if (!nextConversation) throw new Error('This conversation is no longer available.');
      setConversation(nextConversation);
      setAllMessages(messages);
      setResults(messages);
    } catch (error) {
      setLoadError(error.message || 'Unable to load message history.');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setSearchError('');
      setIsSearching(true);
      try {
        const nextResults = query.trim()
          ? await MessagingService.searchMessages(conversationId, query)
          : allMessages;
        if (active) setResults(nextResults);
      } catch (error) {
        if (active) setSearchError(error.message || 'Search failed. Please try again.');
      } finally {
        if (active) setIsSearching(false);
      }
    }, query.trim() ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, conversationId, allMessages]);

  const emptyText = useMemo(() => query.trim()
    ? `No messages match “${query.trim()}”.`
    : 'No message history yet.', [query]);

  return (
    <main className="message-history-page">
      <header className="message-history-header">
        <button type="button" onClick={onBack} aria-label="Back to conversation"><IconArrowLeft size={18} /></button>
        <div>
          <span className="message-history-eyebrow">Conversation archive</span>
          <h1>Message history</h1>
          <p>{conversation?.title || 'Conversation'}</p>
        </div>
      </header>
      <section className="message-history-body">
        <div className="message-history-search">
          <IconSearch size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search text, system messages or file names" aria-label="Search message history" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><IconX size={14} /></button>}
        </div>
        {!isLoading && !loadError && !searchError && (
          <div className="message-history-summary" aria-live="polite">
            <span>{query.trim() ? `Results for “${query.trim()}”` : 'All messages'}</span>
            <strong>{results.length}</strong>
          </div>
        )}
        {loadError ? (
          <div className="message-inline-error" role="alert"><p>Unable to load message history. {loadError}</p><button type="button" onClick={loadHistory}>Retry</button></div>
        ) : searchError ? (
          <div className="message-inline-error" role="alert"><p>Search failed. {searchError}</p><button type="button" onClick={() => setQuery((value) => `${value} `)}>Retry</button></div>
        ) : isLoading ? (
          <div className="message-loading-state">Loading message history…</div>
        ) : results.length ? (
          <div className="message-history-results" aria-busy={isSearching}>
            {results.map((message) => <HistoryMessage key={message.id} message={message} keyword={query} onOpen={onOpenMessage} />)}
          </div>
        ) : (
          <div className="message-history-empty"><IconSearch size={28} /><h2>{emptyText}</h2><p>Try another keyword or return to the conversation.</p></div>
        )}
        {isSearching && <p className="message-pending-status" role="status">Searching…</p>}
      </section>
    </main>
  );
}
