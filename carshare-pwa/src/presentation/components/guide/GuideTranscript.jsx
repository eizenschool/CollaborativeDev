// ===== PRESENTATION LAYER (GuideTranscript) =====
// The scrollable message list: user bubbles, assistant bubbles (with their
// quick replies, recommendation cards, place spotlights, actions and
// feedback controls), and the "thinking" indicator. Extracted out of
// TumpangGuidePage.jsx, which held this inline alongside all its state.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { guideFallbackReasonLabel, guideFeedbackReasons } from '../../../business-logic/guide/GuideLanguage.js';
import { Button } from '../ui/Button.jsx';
import { IconRoute, IconShield } from '../icons.jsx';
import GuideRecommendationCard from './GuideRecommendationCard.jsx';
import GuidePlaceSpotlight from './GuidePlaceSpotlight.jsx';
import GuidePlaceFollowUp from './GuidePlaceFollowUp.jsx';

// A quick reply is shown as "Name · State" so two same-named venues can be
// told apart, but only the name is sent - the server matches a reply against
// catalogue names, and the extra state token drags a token-overlap score
// below the match threshold instead of helping it.
function quickReplyText(label) {
  const name = String(label || '').split('·')[0].trim();
  return name || String(label || '').trim();
}

function AssistantBubble({ response, copy, language, languagePack, unlimitedTurns, actionStates, feedbackState, showQuickReplies, onQuickReply, onAction, onResponseAction, onFeedback, onRetry, onLoadMore, chatScrollRef }) {
  const [negativeOpen, setNegativeOpen] = useState(false);
  const navigate = useNavigate();
  const isGuestQuotaReached = response.fallbackReason === 'guest_recommendation_limit' && !unlimitedTurns;
  // A verified rules fallback is still a Guide response the user can judge.
  // Excluding it made the feedback controls disappear exactly when the user
  // most needed to report a timeout, rate limit or provider failure.
  const canFeedback = ['clarify', 'recommend', 'help', 'action', 'place_info', 'travel_info'].includes(response.mode) && response.traceId !== 'welcome' && response.source !== 'unavailable';
  const selectedFeedback = feedbackState?.sentiment || null;
  return (
    <article className={`guide-message guide-message--assistant guide-message--${response.mode}`}>
      <div className="guide-avatar" aria-hidden="true"><IconRoute size={17} /></div>
      <div className="guide-message__content">
         {(!response.placeInfo || !response.placeInfo.place) && <p>{response.localizedMessage || response.assistantMessage || response.placeInfo?.summary}</p>}
        {showQuickReplies && response.quickReplies?.length > 0 && (
          // The server has been sending these options since the first
          // clarify branch existed; nothing ever rendered them, so a
          // question like "which place should I check the forecast for?"
          // reached the traveller with its answers stripped out.
          <div className="guide-quick-replies" role="group" aria-label={copy.quickRepliesLabel || 'Suggested replies'}>
            {response.quickReplies.map((label) => (
              <Button key={label} size="small" variant="secondary" onClick={() => onQuickReply(quickReplyText(label))}>{label}</Button>
            ))}
          </div>
        )}
        {response.mode === 'emergency' && <div className="guide-emergency-actions">{response.actions.map((action) => action.href?.startsWith('tel:') ? <a key={action.type} className="ui-button ui-button--danger ui-button--medium" href={action.href}>{action.label}</a> : <Link key={action.type} className="ui-button ui-button--secondary ui-button--medium" to={action.href}>{action.label}</Link>)}</div>}
        {response.mode === 'catalogue_missing' && response.actions?.length > 0 && <div className="guide-emergency-actions">{response.actions.map((action) => <Button key={`${action.type}:${action.requestedName}`} size="small" variant="secondary" onClick={() => onResponseAction(action)}>{action.label}</Button>)}</div>}
        {response.mode === 'action' && response.actions?.length > 0 && <div className="guide-emergency-actions">{response.actions.map((action) => <Button key={`${action.type}:${action.placeId || 'plan'}`} size="small" variant="primary" onClick={() => onResponseAction(action)}>{action.label}</Button>)}</div>}
        {response.fallbackReason && !isGuestQuotaReached && <p className="guide-fallback-note"><IconShield size={14} /> {response.source === 'unavailable' ? copy.retryNotice : copy.rulesFallback} · {guideFallbackReasonLabel(response.fallbackReason, language, languagePack)}</p>}
        {isGuestQuotaReached && (
          <div className="guide-emergency-actions">
            <Button
              size="small" variant="primary"
              onClick={() => navigate('/auth', { state: { from: '/assistant', reason: 'Sign in for unlimited Tumpang Guide recommendations.' } })}
            >
              {copy.signIn}
            </Button>
          </div>
        )}
        {response.retryable && <Button size="small" variant="secondary" onClick={() => onRetry(response)} disabled={response.retrying}>{response.retrying ? copy.thinking : copy.retryGemini}</Button>}
         {response.placeInfo?.place && (response.placeInfo.followUp
           ? <GuidePlaceFollowUp placeInfo={response.placeInfo} copy={copy} />
           : <GuidePlaceSpotlight placeInfo={response.placeInfo} planState={response.planState} copy={copy} language={language} languagePack={languagePack} chatScrollRef={chatScrollRef} />)}
        {response.externalPlaceInfo && <section className="guide-external-place" aria-label={response.externalPlaceInfo.officialName || copy.sourceLabel}>
          <p>{response.externalPlaceInfo.summary}</p>
          {response.externalPlaceInfo.highlights?.length > 0 && <ul>{response.externalPlaceInfo.highlights.map((item) => <li key={item}>{item}</li>)}</ul>}
          <p><small>{response.externalPlaceInfo.catalogueStatus === 'external_not_actionable'
            ? language === 'zh-CN' ? '此地点不在 Let\'s Tumpang 目录中，因此不能收藏、推荐或建立共乘操作。'
              : language === 'ms' ? 'Tempat ini tiada dalam katalog Let\'s Tumpang, jadi tindakan simpan, cadangan dan tumpangan tidak tersedia.'
                : language === 'ta' ? 'இந்த இடம் Let\'s Tumpang பட்டியலில் இல்லை; சேமிப்பு, பரிந்துரை மற்றும் பயணச் செயல்கள் கிடையாது.'
                  : 'This place is not in the Let\'s Tumpang catalogue, so no save, recommendation or ride action is available.' : ''}</small></p>
          {response.externalPlaceInfo.sources?.length > 0 && <details><summary>{copy.sourceLabel} ({response.externalPlaceInfo.sources.length})</summary><ol>{response.externalPlaceInfo.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ol></details>}
        </section>}
        {response.recommendations?.length > 0 && <div className="guide-recommendations">{response.recommendations.map((recommendation) => <GuideRecommendationCard key={`${response.batchId || response.traceId}:${recommendation.placeId}`} recommendation={recommendation} featured={recommendation.role === 'best_match'} batchId={response.batchId} language={language} languagePack={languagePack} planState={response.planState} actionState={actionStates[`${recommendation.placeId}:${response.planState?.startDate || ''}`]} onAction={onAction} chatScrollRef={chatScrollRef} />)}</div>}
        {response.mode === 'recommend' && response.recommendations?.length > 0 && response.recommendations.length < 3 && <button type="button" className="guide-text-action" onClick={onLoadMore}>{copy.showMore}</button>}
         <div className="guide-message__meta">{!unlimitedTurns && response.mode !== 'emergency' && <span>{copy.remaining(response.remainingTurns)}</span>}
           {canFeedback && <><button type="button" className={selectedFeedback === 'up' ? 'is-selected' : ''} onClick={() => onFeedback(response, selectedFeedback === 'up' ? 'clear' : 'up', 'helpful')}>{copy.helpful}</button><button type="button" className={selectedFeedback === 'down' ? 'is-selected' : ''} onClick={() => { if (selectedFeedback !== 'down') onFeedback(response, 'down', 'not_relevant'); setNegativeOpen((open) => !open); }}>{copy.notRelevant}</button>{negativeOpen && <select aria-label={copy.feedbackReason} value={selectedFeedback === 'down' ? (feedbackState.reason || 'not_relevant') : 'not_relevant'} onChange={(event) => { setNegativeOpen(false); onFeedback(response, 'down', event.target.value); }}><option value="">{copy.chooseFeedbackReason}</option>{guideFeedbackReasons(language, languagePack).map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select>}{selectedFeedback === 'down' && <button type="button" className="guide-feedback-clear" onClick={() => onFeedback(response, 'clear', 'not_relevant')}>×</button>}</>}
        </div>
      </div>
    </article>
  );
}

export default function GuideTranscript({
  messages, copy, language, languagePack, unlimitedTurns, actionStates, feedbackStates,
  busy, latestAssistantTrace, latestRecommendationTrace, chatScrollRef,
  onQuickReply, onAction, onResponseAction, onFeedback, onRetry, onLoadMore
}) {
  return (
    <div ref={chatScrollRef} className="guide-chat__messages" aria-live="polite">
      {messages.map((message) => {
        if (message.role === 'user') return <article key={message.id} className="guide-message guide-message--user"><p>{message.text}</p></article>;
        const bubble = (
          <AssistantBubble
            response={message.response} copy={copy} language={language} languagePack={languagePack}
            unlimitedTurns={unlimitedTurns} actionStates={actionStates} feedbackState={feedbackStates[message.response.traceId]}
            showQuickReplies={!busy && message.response.traceId === latestAssistantTrace}
            onQuickReply={onQuickReply} onAction={onAction} onResponseAction={onResponseAction}
            onFeedback={onFeedback} onRetry={onRetry} onLoadMore={onLoadMore} chatScrollRef={chatScrollRef}
          />
        );
        const isOldRecommendation = message.response.recommendations?.length > 0 && message.response.traceId !== latestRecommendationTrace;
        return (
          <div key={message.id} className={`guide-batch ${message.response.recommendations?.length ? 'has-recommendations' : ''}`}>
            {isOldRecommendation
              ? <details><summary>{message.response.batchId ? `${copy.batchLabel} · ${message.response.batchId.slice(-6)}` : copy.smart}</summary>{bubble}</details>
              : bubble}
          </div>
        );
      })}
      {busy && (
        <article className="guide-message guide-message--assistant">
          <div className="guide-avatar"><IconRoute size={17} /></div>
          <div className="guide-message__content"><p className="guide-thinking"><span /> {copy.thinking}</p></div>
        </article>
      )}
    </div>
  );
}
