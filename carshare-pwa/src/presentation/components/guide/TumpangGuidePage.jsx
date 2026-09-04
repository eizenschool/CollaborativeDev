import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getCurrentLocationPreview } from '../../../business-logic/GooglePlacesService.js';
import { TumpangGuideService } from '../../../business-logic/guide/TumpangGuideService.js';
import { GUIDE_ACTION, GUIDE_CORE_LANGUAGES, GUIDE_LANGUAGES, GUIDE_LIMITS, GUIDE_STORAGE } from '../../../business-logic/guide/constants.js';
import {
  getInitialGuideLanguage, guideCategoryLabel, guideCopy, guideFallbackReasonLabel, guideFeedbackReasons,
  normalizeGuideLanguage, detectGuideLanguage
} from '../../../business-logic/guide/GuideLanguage.js';
import { normalizePlanState } from '../../../business-logic/guide/GuideIntentParser.js';
import { guideChatStorageKey, readGuideChatSnapshot, saveGuideChatSnapshot } from '../../../business-logic/guide/GuideChatCache.js';
import { pickGuideGreeting } from '../../../business-logic/guide/GuideGreetings.js';
import { subscribeGuideSessionEvents } from '../../../business-logic/guide/GuideChatEvents.js';
import { guideResponseContextText } from '../../../business-logic/guide/GuidePolicy.js';
import { localizeGuideResponse, localizedDifferentPlacesCommand } from '../../../business-logic/guide/GuideResponseLocalization.js';
import { CATEGORY } from '../../../business-logic/discovery/constants.js';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { IconArrowRight, IconCheck, IconClock, IconMapPin, IconMicrophone, IconRoute, IconSend, IconShield, IconStop } from '../icons.jsx';
import ConfirmedLocationInput from '../maps/ConfirmedLocationInput.jsx';
import GuideOnboarding from './GuideOnboarding.jsx';
import GuideRecommendationCard from './GuideRecommendationCard.jsx';
import GuidePlaceSpotlight from './GuidePlaceSpotlight.jsx';
import PlacePoster from '../discover/PlacePoster.jsx';
import { useGuideSpeechInput } from './useGuideSpeechInput.js';

const GUIDE_SPEECH_LANGUAGE_KEY = 'letstumpang_m6_guide_speech_language_v1';
const GUIDE_SPEECH_LANGUAGE_OPTIONS = Object.freeze([
  { value: 'auto', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'ta', label: 'தமிழ்' }
]);
const GUIDE_SPEECH_LANGUAGE_VALUES = new Set(GUIDE_SPEECH_LANGUAGE_OPTIONS.map((option) => option.value));

function initialSpeechLanguage() {
  try {
    const stored = localStorage.getItem(GUIDE_SPEECH_LANGUAGE_KEY);
    return GUIDE_SPEECH_LANGUAGE_VALUES.has(stored) ? stored : 'auto';
  } catch { return 'auto'; }
}

function spokenLanguageLabel(language) {
  if (language === 'auto') return 'Auto-detect';
  if (language === 'zh-CN') return '我说的语言';
  if (language === 'ms') return 'Bahasa pertuturan';
  if (language === 'ta') return 'பேசும் மொழி';
  return 'Spoken language';
}

const createVisitorId = () => {
  const key = 'letstumpang_m6_guide_visitor_v1';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() || `guest-${Date.now()}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return globalThis.crypto?.randomUUID?.() || `guest-${Date.now()}`;
  }
};
const createWelcome = (language, user) => {
  const greeting = pickGuideGreeting(language);
  return { id: 'welcome', role: 'assistant', response: {
    mode: 'clarify', assistantMessage: greeting.text, greetingIndex: greeting.index, language, planState: normalizePlanState({ language }),
    quickReplies: [], recommendations: [], actions: [],
    remainingTurns: user ? Number.MAX_SAFE_INTEGER : GUIDE_LIMITS.GUEST_SESSION_TURNS, fallbackReason: null, source: 'rules', batchId: null, traceId: 'welcome'
  } };
};

function onboardingSeen() {
  try { return localStorage.getItem(GUIDE_STORAGE.ONBOARDING_KEY) === 'seen'; } catch { return false; }
}

function saveCurrentChat(visitorSessionId, userId, planState, messages, feedbackStates = {}, sessionId = null) {
  saveGuideChatSnapshot(visitorSessionId, userId, planState, messages, feedbackStates, sessionId);
  if (sessionId && userId) {
    TumpangGuideService.cacheSessionSummary({ userId, sessionId, planState, messages });
  }
}

function activeChatKey(visitorSessionId, userId, requestedSessionId) {
  return guideChatStorageKey(visitorSessionId, userId, requestedSessionId || null);
}

function feedbackStateMap(rows = []) {
  return Object.fromEntries(rows.filter((row) => row?.traceId && row.sentiment).map((row) => [row.traceId, {
    sentiment: row.sentiment,
    reason: row.reason || null
  }]));
}

function localizeStoredMessages(messages, language, languagePack = null) {
  return (messages || []).map((message) => message.response
    ? { ...message, response: localizeGuideResponse(message.response, language, languagePack) }
    : message);
}

function formatCopy(value, replacements, fallback) {
  if (typeof value === 'function') return value.length === 1
    ? value(String(Object.values(replacements)[0] || '').split(', '))
    : value(...Object.values(replacements));
  if (typeof value !== 'string') return fallback;
  return value.replace(/\{\{?(\w+)\}?\}/g, (_, key) => String(replacements[key] ?? ''));
}

function PlanSummary({ plan, copy, languagePack, onChange, onUseLocation, onSavePreferences, locationBusy, locationError, canSave }) {
  const patch = (value) => onChange(normalizePlanState({ ...plan, ...value }));
  const originLocation = plan.origin?.placeId
    ? { placeId: plan.origin.placeId }
    : Number.isFinite(plan.origin?.lat) && Number.isFinite(plan.origin?.lng)
      ? { latitude: plan.origin.lat, longitude: plan.origin.lng }
      : null;
  const updateOrigin = (label, location) => patch({
    origin: label ? {
      label,
      ...(location?.placeId ? { placeId: location.placeId } : {}),
      ...(Number.isFinite(Number(location?.latitude)) ? { lat: Number(location.latitude) } : {}),
      ...(Number.isFinite(Number(location?.longitude)) ? { lng: Number(location.longitude) } : {})
    } : null
  });
  const toggleCategory = (category) => {
    const selected = new Set(plan.preferredCategories);
    if (selected.has(category)) selected.delete(category); else selected.add(category);
    patch({ preferredCategories: [...selected] });
  };
  return (
    <aside className="guide-plan" aria-labelledby="guide-plan-title">
      <div className="guide-plan__heading"><div><p className="guide-eyebrow">{copy.livePlan}</p><h2 id="guide-plan-title">{copy.travelBrief}</h2></div><span className="guide-trip-badge" aria-hidden="true"><IconRoute size={22} /></span></div>
      <ConfirmedLocationInput
        id="guide-starting-point"
        label={copy.startingPoint}
        placeholder={copy.startingPointPlaceholder}
        value={plan.origin?.label || ''}
        location={originLocation}
        onChange={updateOrigin}
      />
      <button className="guide-location-button" type="button" onClick={onUseLocation} disabled={locationBusy}><IconMapPin size={16} /> {locationBusy ? copy.locating : copy.useLocation}</button>
      {locationError && <p className="guide-field-error" role="alert">{locationError}</p>}
      <div className="guide-plan__row"><label>{copy.from}<input aria-label={copy.from} type="date" value={plan.startDate || ''} onChange={(event) => patch({ startDate: event.target.value, endDate: event.target.value })} /></label><label>{copy.until}<input aria-label={copy.until} type="date" min={plan.startDate || undefined} value={plan.endDate || ''} onChange={(event) => patch({ endDate: event.target.value })} /></label></div>
      <label>{copy.people}<input aria-label={copy.people} type="number" min="1" max="20" inputMode="numeric" value={plan.partySize || ''} onChange={(event) => patch({ partySize: Number(event.target.value) || null })} /></label>
      <fieldset><legend>{copy.categoryQuestion}</legend><div className="guide-category-chips">{Object.values(CATEGORY).map((category) => <button key={category} type="button" className={plan.preferredCategories.includes(category) ? 'active' : ''} aria-pressed={plan.preferredCategories.includes(category)} onClick={() => toggleCategory(category)}>{guideCategoryLabel(category, plan.language, languagePack)}</button>)}</div></fieldset>
      <Button type="button" size="small" variant="secondary" onClick={onSavePreferences} disabled={!plan.preferredCategories.length}>{canSave ? copy.savePreferences : copy.signInSave}</Button>
      <label className="guide-consent"><input type="checkbox" checked={plan.tripHistoryConsent} onChange={(event) => patch({ tripHistoryConsent: event.target.checked })} /><span><strong>{copy.historyConsent}</strong><small>{copy.historyNote}</small></span></label>
    </aside>
  );
}

function SourceBadge({ response, copy }) {
  void response; void copy;
  return null;
}

function placeInfoContent(info = {}) {
  return info.originalContent || {
    summary: info.summary,
    highlights: info.highlights || [],
    audience: info.audience || [],
    practicalNotes: info.practicalNotes || []
  };
}

function placeInfoTranslationRows(messages, nextLanguage) {
  const target = normalizeGuideLanguage(nextLanguage);
  return (messages || []).flatMap((message) => {
    const info = message.response?.placeInfo; const trace = message.response?.traceId;
    const source = normalizeGuideLanguage(message.response?.originalLanguage || message.response?.language || 'en');
    if (!info || !trace || source === target || info.localizedContent?.[target]) return [];
    const content = placeInfoContent(info);
    return [
      { id: `${trace}:place:summary`, text: content.summary },
      ...(content.highlights || []).map((text, index) => ({ id: `${trace}:place:highlight:${index}`, text })),
      ...(content.audience || []).map((text, index) => ({ id: `${trace}:place:audience:${index}`, text })),
      ...(content.practicalNotes || []).map((text, index) => ({ id: `${trace}:place:note:${index}`, text }))
    ].filter((item) => item.text);
  });
}

function applyPlaceInfoTranslations(response, translations = {}, nextLanguage) {
  if (!response?.placeInfo || !response.traceId) return response;
  const trace = response.traceId; const info = response.placeInfo;
  const target = normalizeGuideLanguage(nextLanguage);
  const source = normalizeGuideLanguage(response.originalLanguage || response.language || 'en');
  const originalContent = placeInfoContent(info);
  const translatedContent = info.localizedContent?.[target] || {
    summary: translations[`${trace}:place:summary`] || originalContent.summary,
    highlights: (originalContent.highlights || []).map((text, index) => translations[`${trace}:place:highlight:${index}`] || text),
    audience: (originalContent.audience || []).map((text, index) => translations[`${trace}:place:audience:${index}`] || text),
    practicalNotes: (originalContent.practicalNotes || []).map((text, index) => translations[`${trace}:place:note:${index}`] || text)
  };
  const selected = source === target ? originalContent : translatedContent;
  return { ...response, placeInfo: {
    ...info, ...selected, originalContent,
    localizedContent: source === target ? (info.localizedContent || {})
      : { ...(info.localizedContent || {}), [target]: translatedContent }
  } };
}

function recommendationTranslationRows(messages, nextLanguage) {
  const target = normalizeGuideLanguage(nextLanguage);
  return (messages || []).flatMap((message) => {
    const trace = message.response?.traceId;
    const source = normalizeGuideLanguage(message.response?.originalLanguage || message.response?.language || 'en');
    if (!trace || source === target) return [];
    return (message.response?.recommendations || []).flatMap((item) => {
      if (item.localizedCopies?.[target]) return [];
      const original = item.originalCopy || {
        reason: item.personalizedReason, why: item.personalizedWhy, tradeoff: item.personalizedTradeoff
      };
      return [
        { id: `${trace}:recommendation:${item.placeId}:reason`, text: original.reason },
        { id: `${trace}:recommendation:${item.placeId}:why`, text: original.why },
        { id: `${trace}:recommendation:${item.placeId}:tradeoff`, text: original.tradeoff }
      ].filter((row) => row.text);
    });
  });
}

function applyRecommendationTranslations(response, translations = {}, nextLanguage) {
  if (!response?.traceId || !response.recommendations?.length) return response;
  const trace = response.traceId; const target = normalizeGuideLanguage(nextLanguage);
  const source = normalizeGuideLanguage(response.originalLanguage || response.language || 'en');
  return { ...response, recommendations: response.recommendations.map((item) => {
    const originalCopy = item.originalCopy || {
      reason: item.personalizedReason, why: item.personalizedWhy, tradeoff: item.personalizedTradeoff
    };
    const translatedCopy = item.localizedCopies?.[target] || {
      reason: translations[`${trace}:recommendation:${item.placeId}:reason`] || originalCopy.reason,
      why: translations[`${trace}:recommendation:${item.placeId}:why`] || originalCopy.why,
      tradeoff: translations[`${trace}:recommendation:${item.placeId}:tradeoff`] || originalCopy.tradeoff
    };
    const selected = source === target ? originalCopy : translatedCopy;
    return {
      ...item, originalCopy,
      localizedCopies: source === target ? (item.localizedCopies || {})
        : { ...(item.localizedCopies || {}), [target]: translatedCopy },
      personalizedReason: selected.reason,
      personalizedWhy: selected.why,
      personalizedTradeoff: selected.tradeoff
    };
  }) };
}

async function prepareLocalizedConversation({ messages, nextLanguage, pack, user, sessionId, visitorSessionId }) {
  const target = normalizeGuideLanguage(nextLanguage);
  const assistantRows = (messages || [])
    .filter((message) => {
      const response = message.response;
      const source = normalizeGuideLanguage(response?.originalLanguage || response?.language || 'en');
      return response && response.traceId !== 'welcome' && source !== target
        && !response.localizedMessages?.[target];
    })
    .map((message) => ({ id: message.response.traceId, text: message.response.assistantMessage }))
    .filter((item) => item.text);
  const placeRows = placeInfoTranslationRows(messages, target);
  const recommendationRows = recommendationTranslationRows(messages, target);
  const translations = assistantRows.length || placeRows.length || recommendationRows.length
    ? await TumpangGuideService.translateMessages({
      user, sessionId, visitorSessionId, language: nextLanguage,
      messages: [...assistantRows, ...placeRows, ...recommendationRows], cacheTranslations: false
    }) : {};
  return (messages || []).map((message) => {
    if (!message.response) return message;
    let response = applyPlaceInfoTranslations(message.response, translations, target);
    response = applyRecommendationTranslations(response, translations, target);
    response = localizeGuideResponse(response, target, pack);
    const translatedMessage = translations[message.response.traceId];
    if (translatedMessage) response = {
      ...response, localizedMessage: translatedMessage,
      localizedMessages: { ...(message.response.localizedMessages || {}), [nextLanguage]: translatedMessage }
    };
    return { ...message, response };
  });
}

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
         {response.placeInfo?.place && <GuidePlaceSpotlight placeInfo={response.placeInfo} planState={response.planState} copy={copy} language={language} languagePack={languagePack} chatScrollRef={chatScrollRef} />}
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

export default function TumpangGuidePage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { sessionId: requestedSessionId } = useParams();
  const [visitorSessionId] = useState(createVisitorId);
  const [language, setLanguage] = useState(getInitialGuideLanguage);
  const [languagePack, setLanguagePack] = useState(null);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [planState, setPlanState] = useState(() => normalizePlanState({ language: getInitialGuideLanguage(), tripHistoryConsent: false }));
  const [messages, setMessages] = useState(() => [createWelcome(getInitialGuideLanguage(), user)]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(() => !onboardingSeen());
  const [pendingAction, setPendingAction] = useState(null);
  const [actionStates, setActionStates] = useState({});
  const [feedbackStates, setFeedbackStates] = useState({});
  const [chatHydrationKey, setChatHydrationKey] = useState(null);
  const [planOpen, setPlanOpen] = useState(true);
  const [speechLanguage, setSpeechLanguage] = useState(() => initialSpeechLanguage());
  const sessionRef = useRef(null);
  const chatScrollRef = useRef(null);
  const restoredChatScrollRef = useRef(null);
  const loadedSessionRef = useRef(null);
  const appliedUiLanguageRequestRef = useRef('');
  const voiceBaseDraftRef = useRef('');
  const voiceInterimRef = useRef('');
  const [voicePreview, setVoicePreview] = useState('');
  const sendInFlightRef = useRef(false);
  const currentCopy = useMemo(() => guideCopy(language, languagePack), [language, languagePack]);
  const transcript = useCallback((text) => setDraft(() => {
    const finalText = String(text || '').trim();
    const next = [voiceBaseDraftRef.current, finalText].filter(Boolean).join(' ');
    voiceInterimRef.current = '';
    setVoicePreview('');
    return next;
  }), []);
  const interimTranscript = useCallback((text) => {
    voiceInterimRef.current = String(text || '').trim();
    setVoicePreview(voiceInterimRef.current);
  }, []);
  const latestResponse = useMemo(() => [...messages].reverse().find((message) => message.response)?.response, [messages]);
  const hasConversation = useMemo(() => messages.some((message) => message.role === 'user'), [messages]);
  const latestRecommendationTrace = useMemo(() => [...messages].reverse().find((message) => message.response?.recommendations?.length)?.response?.traceId || null, [messages]);
  // Only the newest answer's options are still answerable. An older bubble's
  // options belong to a question that has already moved on, and clicking one
  // would send a bare place name into a completely different context.
  const latestAssistantTrace = useMemo(() => [...messages].reverse().find((message) => message.response)?.response?.traceId || null, [messages]);
  const shownPlaceIds = useMemo(() => messages.flatMap((message) => (message.response?.recommendations || []).map((recommendation) => recommendation.placeId)), [messages]);
  const placeContext = useMemo(() => {
    const response = [...messages].reverse().find((message) => message.response?.placeInfo
      || message.response?.recommendations?.length)?.response;
    if (!response) return [];
    const rows = [];
    if (response.placeInfo?.placeId && response.placeInfo?.officialName) {
      rows.push({ placeId: response.placeInfo.placeId, name: response.placeInfo.officialName, role: 'place_info' });
    }
    for (const recommendation of response.recommendations || []) {
      const name = recommendation.place?.name;
      if (recommendation.placeId && name) rows.push({ placeId: recommendation.placeId, name, role: recommendation.role });
    }
    return rows.slice(0, 4);
  }, [messages]);
  const conversationFocus = latestResponse?.placeInfo ? 'place'
    : latestResponse?.recommendations?.length ? 'recommendation_batch'
      : latestResponse?.mode === 'help' ? 'capabilities'
        : latestResponse?.mode === 'action' ? 'action'
          : latestResponse?.mode === 'emergency' ? 'emergency' : 'none';
  // Echoed back verbatim on the next turn so a bare one-word reply to a
  // weather/route clarifying question ("KLCC", "KL") can be understood as
  // answering that specific question instead of being reinterpreted as a
  // fresh, unrelated request. Only ever set by the Guide's own last reply.
  const pendingClarification = latestResponse?.pendingClarification || null;
  const transcribeVoice = useCallback((audio) => TumpangGuideService.transcribeAudio(audio, {
    visitorSessionId, languageHint: speechLanguage
  }), [speechLanguage, visitorSessionId]);
  const speech = useGuideSpeechInput({
    copy: currentCopy, language: speechLanguage, onTranscript: transcript,
    onInterim: interimTranscript, transcribeAudio: transcribeVoice
  });
  const startSpeech = useCallback(() => {
    voiceBaseDraftRef.current = draft.trim();
    voiceInterimRef.current = '';
    setVoicePreview('');
    speech.start();
  }, [draft, speech.start]);
  const changeSpeechLanguage = useCallback((event) => {
    const next = GUIDE_SPEECH_LANGUAGE_VALUES.has(event.target.value) ? event.target.value : 'en';
    setSpeechLanguage(next);
    try { localStorage.setItem(GUIDE_SPEECH_LANGUAGE_KEY, next); } catch { /* Preference persistence is best effort. */ }
  }, []);

  useEffect(() => {
    const key = activeChatKey(visitorSessionId, user?.id, requestedSessionId);
    setChatHydrationKey(null);
    if (!requestedSessionId) loadedSessionRef.current = null;
    if (requestedSessionId && !user?.id) return undefined;

    if (requestedSessionId) {
      // Include the owner in the guard. A user can sign out and another user
      // can open the same URL in the same tab; never reuse the previous
      // account's already-hydrated messages in that case.
      const loadKey = `${user.id}:${requestedSessionId}`;
      if (loadedSessionRef.current === loadKey) return undefined;
      loadedSessionRef.current = loadKey;
      // Staleness is decided by comparing loadedSessionRef against this
      // closure's own loadKey at resolve-time, not by a per-invocation
      // "active" flag reset on cleanup. React 18 StrictMode intentionally
      // mounts -> cleans up -> remounts once in dev: with an `active` flag,
      // the first (real, in-flight) run's own cleanup would mark its later
      // .then()/.catch() a no-op, while the second run sees loadedSessionRef
      // already set to this key and returns early doing nothing - so
      // NEITHER run ever calls setMessages, leaving the page permanently on
      // the empty state this effect seeds below (recreating the earlier
      // "stuck spinner" bug as a silent "history never loads" bug instead).
      // loadedSessionRef only changes when a genuinely different session is
      // requested, so this check still correctly discards a reply that
      // arrives after the user has since navigated elsewhere.
      const stillCurrent = () => loadedSessionRef.current === loadKey;
      // Do not leave the previous conversation visible while another owner's
      // session is being loaded. This also prevents a failed history request
      // from looking like a successful restore of the wrong chat.
      setMessages([]);
      setPlanState(normalizePlanState({ language }));
      setFeedbackStates({});
      setBusy(true);
      const restoreCachedSession = () => {
        const stored = readGuideChatSnapshot(visitorSessionId, user.id, requestedSessionId);
        if (!stored?.messages?.length) return false;
        const restored = localizeStoredMessages(stored.messages, language, languagePack);
        sessionRef.current = { id: stored.sessionId || requestedSessionId, userId: user.id };
        setMessages(restored);
        setFeedbackStates(stored.feedbackStates || {});
        if (stored.planState) setPlanState(normalizePlanState(stored.planState));
        return true;
      };
      Promise.all([
        TumpangGuideService.getMessages(user.id, requestedSessionId),
        TumpangGuideService.listFeedback(user.id, requestedSessionId).catch(() => [])
      ]).then(async ([rows, feedbackRows]) => {
        if (!stillCurrent()) return;
        const loaded = rows.map((row) => row.role === 'user' ? ({ id: row.id, role: 'user', text: row.text }) : ({
          id: row.traceId || row.id,
          role: 'assistant',
          response: row.response ? { ...row.response, localizedMessage: row.response.localizedMessages?.[language] || row.response.localizedMessage } : row.response
        })).filter((item) => item.role === 'user' || item.response);
        const localized = localizeStoredMessages(loaded, language, languagePack);
        // The live persistence RPC deliberately stores a compact response with
        // Place IDs, not duplicated catalogue rows. Re-fetch those rows through
        // the Guide service before rendering a historical conversation.
        const hydrated = await Promise.all(localized.map(async (item) => {
          if (!item.response) return item;
          try {
            return { ...item, response: await TumpangGuideService.hydrateResponse(item.response) };
          } catch {
            // A retired place must not make an otherwise valid saved chat
            // impossible to open. The conversation remains readable and the
            // missing card is omitted by the service-level hydration contract.
            return { ...item, response: { ...item.response, recommendations: [] } };
          }
        }));
        const last = [...hydrated].reverse().find((item) => item.response?.planState);
        sessionRef.current = { id: requestedSessionId, userId: user.id };
        // A saved session can exist locally while its optional server history
        // is temporarily unavailable (for example while an Edge deployment is
        // rolling out). Prefer that exact cached batch over creating a new
        // welcome chat; never silently rerun recommendations.
        let restoredCached = false;
        const hasAssistantResponse = hydrated.some((item) => item.response);
        if (hasAssistantResponse) setMessages(hydrated);
        else {
          restoredCached = restoreCachedSession();
          if (!restoredCached) setMessages([createWelcome(language, user)]);
        }
        // Keep feedback bundled with a local recovery snapshot when the
        // history request failed or returned no rows. A successful server
        // history response remains authoritative, including an empty map.
        if (!restoredCached || feedbackRows.length) setFeedbackStates(feedbackStateMap(feedbackRows));
        if (last?.response?.planState) setPlanState(normalizePlanState(last.response.planState));
        setChatHydrationKey(key);
      }).catch(() => {
        if (!stillCurrent()) return;
        // A blank screen with no error text reads as broken, not just
        // unavailable. If there is no local snapshot to fall back to, still
        // show a fresh welcome bubble alongside the notice instead of
        // leaving `messages` at the [] this branch was seeded with.
        if (!restoreCachedSession()) {
          setMessages([createWelcome(language, user)]);
          setNotice(currentCopy.plansUnavailable || 'This saved plan could not be loaded.');
        }
        setChatHydrationKey(key);
      }).finally(() => { if (stillCurrent()) setBusy(false); });
    } else {
      sessionRef.current = null;
      const stored = readGuideChatSnapshot(visitorSessionId, user?.id);
      if (stored?.messages?.length) {
        if (stored.sessionId && user?.id) sessionRef.current = { id: stored.sessionId, userId: user.id };
        setMessages(localizeStoredMessages(stored.messages, language, languagePack));
        setPlanState(normalizePlanState(stored.planState));
        setFeedbackStates(stored.feedbackStates || {});
      } else {
        setFeedbackStates({});
      }
      setChatHydrationKey(key);
    }
    return undefined;
  }, [requestedSessionId, user?.id, visitorSessionId]);

  useEffect(() => {
    const requestedScrollTop = Number(location.state?.guideRestoreScrollTop);
    const hydrationKey = activeChatKey(visitorSessionId, user?.id, requestedSessionId);
    if (!Number.isFinite(requestedScrollTop) || chatHydrationKey !== hydrationKey) return undefined;

    const restoreKey = `${location.key}:${requestedScrollTop}`;
    if (restoredChatScrollRef.current === restoreKey) return undefined;
    restoredChatScrollRef.current = restoreKey;

    const restore = () => {
      const container = chatScrollRef.current;
      if (!container) return;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = Math.min(Math.max(0, requestedScrollTop), maxScrollTop);
    };
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(restore);
    });
    const retry = window.setTimeout(restore, 120);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.clearTimeout(retry);
    };
  }, [chatHydrationKey, location.key, location.state, requestedSessionId, user?.id, visitorSessionId]);

  useEffect(() => {
    const key = activeChatKey(visitorSessionId, user?.id, requestedSessionId);
    if (chatHydrationKey !== key) return;
    const currentSessionId = requestedSessionId || sessionRef.current?.id || null;
    saveCurrentChat(visitorSessionId, user?.id, planState, messages, feedbackStates, currentSessionId);
  }, [requestedSessionId, visitorSessionId, user?.id, chatHydrationKey, planState, messages, feedbackStates]);

  useEffect(() => {
    const requested = normalizeGuideLanguage(latestResponse?.uiLanguageChange);
    const requestKey = latestResponse?.traceId && requested
      ? `${latestResponse.traceId}:${requested}` : '';
    if (!latestResponse?.uiLanguageChange || !requestKey || requested === language || !GUIDE_LANGUAGES.includes(requested)
      || appliedUiLanguageRequestRef.current === requestKey) return;
    // The existing language hydration effect owns the atomic translation and
    // language-pack load. This effect only commits an explicit model-confirmed
    // interface-language request; ordinary multilingual answers never reach
    // this path and therefore cannot change the UI language.
    appliedUiLanguageRequestRef.current = requestKey;
    setPlanState((current) => normalizePlanState({ ...current, language: requested }));
  }, [language, latestResponse?.traceId, latestResponse?.uiLanguageChange]);

  useEffect(() => {
    const restoredLanguage = normalizeGuideLanguage(planState?.language || language);
    if (restoredLanguage === language || busy || languageBusy || !messages.length) return undefined;
    let active = true;
    setLanguageBusy(true);
    (async () => {
      const pack = GUIDE_CORE_LANGUAGES.includes(restoredLanguage)
        ? null : await TumpangGuideService.getLanguagePack(restoredLanguage);
      const localized = await prepareLocalizedConversation({
        messages, nextLanguage: restoredLanguage, pack, user,
        sessionId: sessionRef.current?.id, visitorSessionId
      });
      if (!active) return;
      setLanguage(restoredLanguage); setLanguagePack(pack); setMessages(localized);
      try { localStorage.setItem(GUIDE_STORAGE.LANGUAGE_KEY, restoredLanguage); } catch { /* Optional preference. */ }
    })().catch(() => { if (active) setNotice(currentCopy.languageUnavailable); })
      .finally(() => { if (active) setLanguageBusy(false); });
    return () => { active = false; };
  }, [planState?.language, busy]);

  useEffect(() => {
    const recommendations = messages.flatMap((message) => (message.response?.recommendations || []).map((item) => ({ item, plan: message.response.planState })));
    if (!user?.id || !recommendations.length) return;
    Promise.all(recommendations.map(async ({ item, plan }) => {
      const key = `${item.placeId}:${plan?.startDate || ''}`;
      try { return [key, await TumpangGuideService.getActionState(user.id, item.placeId, plan?.startDate)]; }
      catch { return [key, null]; }
    })).then((entries) => setActionStates((current) => Object.fromEntries([
      ...Object.entries(current),
      ...entries.filter(([, value]) => value)
    ]))).catch(() => { /* Actions can still be confirmed on demand. */ });
  }, [messages, user?.id]);

  const closeOnboarding = () => { try { localStorage.setItem(GUIDE_STORAGE.ONBOARDING_KEY, 'seen'); } catch { /* no-op */ } setOnboardingOpen(false); };
  const ensureSession = () => { if (!user || sessionRef.current) return sessionRef.current; sessionRef.current = TumpangGuideService.createSession(user, language, planState); return sessionRef.current; };

  const send = async (text = draft, { replaceTraceId = null, retry = false, clientTurnId = null } = {}) => {
    const clean = String(text || '').trim();
    if (!clean || busy || sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    // Adopt the language of a fresh conversation's first message in one
    // shot, instead of staying stuck on whatever UI language a previous
    // chat left in localStorage. Never re-detect mid-conversation - that
    // would make the interface flicker on a code-switched sentence, and
    // would fight an explicit change_interface_language request.
    if (!hasConversation && !retry) {
      const detected = detectGuideLanguage(clean, language);
      if (detected !== language && GUIDE_LANGUAGES.includes(detected)) {
        setPlanState((current) => normalizePlanState({ ...current, language: detected }));
      }
    }
    const stableClientTurnId = clientTurnId || globalThis.crypto?.randomUUID?.();
    const session = ensureSession();
    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: clean };
    const nextMessages = replaceTraceId ? messages : [...messages, userMessage];
    setMessages(nextMessages); setDraft(''); setBusy(true); setNotice('');
    try {
      const response = await TumpangGuideService.sendTurn({
        clientTurnId: stableClientTurnId,
        user, sessionId: session?.id, visitorSessionId, text: clean, language, planState: retry ? (messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.planState || planState) : planState,
        uiLanguage: language, responseLanguage: detectGuideLanguage(clean, language),
        messages: nextMessages.map((message) => message.response
          ? { role: 'assistant', text: guideResponseContextText(message.response) } : message),
        placeContext, conversationFocus,
        // A retry replays an older historical turn, not necessarily the
        // conversation's actual last reply, so it must never carry forward
        // a pending clarification that belongs to a different, later turn.
        pendingClarification: retry ? null : pendingClarification,
        shownPlaceIds: retry ? shownPlaceIds.filter((id) => !(messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.recommendations || []).some((item) => item.placeId === id)) : shownPlaceIds,
        languageLocked: false, online: navigator.onLine,
        retryBatchId: retry ? messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.batchId : null,
        retryPlaceIds: retry ? (messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.recommendations || []).map((item) => item.placeId) : [],
        retryRecommendations: retry ? (messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.recommendations || []).map(({ placeId, role, verifiedReasonCodes, tradeoffCode }) => ({ placeId, role, verifiedReasonCodes, tradeoffCode })) : []
      });
      if (response.sessionId) {
        sessionRef.current = { id: response.sessionId, userId: user?.id || null };
      }
      const responseLanguage = normalizeGuideLanguage(response.responseLanguage || response.language || language);
      const rawDecorated = {
        ...response, language: responseLanguage, responseLanguage,
        originalLanguage: response.originalLanguage || responseLanguage,
        planState: response.planState ? { ...response.planState, language } : { ...planState, language },
        localizedMessage: response.assistantMessage,
        promptText: clean, retrying: false,
        recommendations: (response.recommendations || []).map((item) => ({ ...item, batchId: response.batchId }))
      };
      // Response language is per turn. Never translate the existing chat or
      // rewrite the interface language just because the user spoke another
      // language in this message.
      setPlanState(normalizePlanState({ ...(response.planState || planState), language }));
      setMessages(replaceTraceId
        ? nextMessages.map((message) => message.response?.traceId === replaceTraceId ? { ...message, response: rawDecorated, id: response.traceId } : message)
        : [...nextMessages, { id: response.traceId, role: 'assistant', response: rawDecorated }]);
      if (response.persistenceWarning) setNotice(currentCopy.persistenceWarning);
    } catch { setNotice(currentCopy.retryNotice); }
    finally { sendInFlightRef.current = false; setBusy(false); }
  };

  const retry = (response) => {
    // promptText is a browser-only convenience and is intentionally not part
    // of the persisted response payload. Recover it from the preceding user
    // message when a saved conversation is reopened, so Retry Gemini also
    // works from Past plans and after a detail-page round trip.
    const responseIndex = messages.findIndex((message) => message.response?.traceId === response.traceId);
    const previousUserMessage = responseIndex >= 0
      ? [...messages.slice(0, responseIndex)].reverse().find((message) => message.role === 'user')?.text
      : null;
    const promptText = response.promptText || previousUserMessage;
    if (!promptText) { setNotice(currentCopy.retryNotice); return; }
    setMessages((current) => current.map((message) => message.response?.traceId === response.traceId
      ? { ...message, response: { ...response, retrying: true } } : message));
    // Reuse the original id. A network timeout does not prove that the Edge
    // request stopped; retrying with a new id could execute Gemini/Groq twice.
    send(promptText, { replaceTraceId: response.traceId, retry: true, clientTurnId: response.clientTurnId || null });
  };
  const loadMore = () => send(localizedDifferentPlacesCommand(language, languagePack), {});
  const startNewChat = () => {
    const nextPlan = normalizePlanState({ language });
    const welcome = createWelcome(language, user);
    const nextMessages = [{ ...welcome, response: localizeGuideResponse(welcome.response, language, languagePack) }];
    sessionRef.current = null;
    loadedSessionRef.current = null;
    setFeedbackStates({});
    saveCurrentChat(visitorSessionId, user?.id, nextPlan, nextMessages, {}, null);
    setMessages(nextMessages); setPlanState(nextPlan); setDraft(''); setNotice('');
    setChatHydrationKey(activeChatKey(visitorSessionId, user?.id, null));
    navigate('/assistant', { replace: true });
  };

  useEffect(() => {
    if (!user?.id) return undefined;
    return subscribeGuideSessionEvents((event) => {
      if (event.userId !== user.id) return;
      const affectsCurrent = event.type === 'all_sessions_deleted'
        || (event.type === 'session_deleted' && (event.sessionId === requestedSessionId || event.sessionId === sessionRef.current?.id));
      if (!affectsCurrent) return;
      startNewChat();
      setNotice(currentCopy.sessionDeletedElsewhere);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, requestedSessionId, currentCopy.sessionDeletedElsewhere]);

  const useCurrentLocation = async () => { setLocationBusy(true); setLocationError(''); try { const point = await getCurrentLocationPreview(); setPlanState((current) => normalizePlanState({ ...current, origin: { label: 'Current location', lat: point.latitude, lng: point.longitude } })); } catch { setLocationError(currentCopy.actionFailed); } finally { setLocationBusy(false); } };

  const requestAction = (type, recommendation, cardPlan) => {
    if (!user) { navigate('/auth', { state: { from: '/assistant', reason: 'Sign in before saving a Tumpang Guide action.' } }); return; }
    setPendingAction({ type, recommendation, planState: cardPlan, actionState: actionStates[`${recommendation.placeId}:${cardPlan.startDate || ''}`] });
  };
  const requestPreferenceSave = () => { if (!user) { navigate('/auth', { state: { from: '/assistant', reason: 'Sign in before saving travel preferences.' } }); return; } setPendingAction({ type: GUIDE_ACTION.SAVE_PREFERENCES, planState }); };
  const requestResponseAction = (action) => {
    if (!user) { navigate('/auth', { state: { from: '/assistant', reason: 'Sign in before completing a Tumpang Guide action.' } }); return; }
    if (action.type === GUIDE_ACTION.REQUEST_CATALOGUE) {
      setPendingAction({ type: action.type, requestedName: action.requestedName, planState }); return;
    }
    if (action.type === GUIDE_ACTION.SAVE_PREFERENCES) {
      setPendingAction({ type: action.type, planState }); return;
    }
    if ([GUIDE_ACTION.RECORD_INTEREST, GUIDE_ACTION.REGISTER_RIDE_ALERT].includes(action.type) && action.placeId) {
      const actionPlan = normalizePlanState({ ...planState, startDate: action.travelDate || planState.startDate,
        endDate: action.travelDate || planState.endDate || planState.startDate });
      setPendingAction({ type: action.type,
        recommendation: { placeId: action.placeId, place: action.place || { id: action.placeId, name: action.placeName } },
        planState: actionPlan, actionState: actionStates[`${action.placeId}:${actionPlan.startDate || ''}`] });
    }
  };
  const confirmAction = async () => {
    const action = pendingAction; setPendingAction(null);
    const cardPlan = action.planState || planState; const key = action.recommendation ? `${action.recommendation.placeId}:${cardPlan.startDate || ''}` : null;
    try {
      if (action.type === 'cancel_interest' || action.type === 'cancel_ride_alert') {
        await TumpangGuideService.cancelAction({ type: action.type === 'cancel_interest' ? GUIDE_ACTION.RECORD_INTEREST : GUIDE_ACTION.REGISTER_RIDE_ALERT, userId: user.id, placeId: action.recommendation.placeId, travelDate: cardPlan.startDate, registrationId: action.actionState?.alert?.id });
        setActionStates((current) => ({ ...current, [key]: { ...current[key], ...(action.type === 'cancel_interest' ? { interest: null } : { alert: null }) } }));
      } else {
        const result = await TumpangGuideService.confirmAction({ type: action.type, userId: user.id, placeId: action.recommendation?.placeId, travelDate: cardPlan.startDate, preferredCategories: cardPlan.preferredCategories, requestedName: action.requestedName });
        if (key && action.type === GUIDE_ACTION.RECORD_INTEREST) setActionStates((current) => ({ ...current, [key]: { ...current[key], interest: result.interest || { recorded: true } } }));
        if (key && action.type === GUIDE_ACTION.REGISTER_RIDE_ALERT) setActionStates((current) => ({ ...current, [key]: { ...current[key], alert: result.registration || { status: 'active' } } }));
      }
      setNotice(action.type.includes('alert') ? (action.type.startsWith('cancel') ? currentCopy.cancelAlert : currentCopy.alertSaved) : action.type.includes('interest') ? (action.type.startsWith('cancel') ? currentCopy.cancelInterest : currentCopy.interestSaved) : action.type === GUIDE_ACTION.SAVE_PREFERENCES ? currentCopy.preferencesSaved : currentCopy.catalogueRequestSaved);
    } catch { setNotice(currentCopy.actionFailed); }
  };
  const feedback = async (response, sentiment, reason) => {
    if (!user?.id || !sessionRef.current?.id || !response) {
      setNotice(currentCopy.feedbackUnavailable);
      return;
    }
    try {
      await TumpangGuideService.saveFeedback(user.id, sessionRef.current.id, response.traceId, sentiment, reason);
      setFeedbackStates((current) => ({ ...current, [response.traceId]: sentiment === 'clear' ? null : { sentiment, reason } }));
      setNotice(sentiment === 'clear' ? currentCopy.feedbackRemoved : currentCopy.feedbackSaved);
    } catch { setNotice(currentCopy.feedbackError); }
  };

  return (
    <main className="guide-page">
      <GuideOnboarding open={onboardingOpen} onClose={closeOnboarding} language={language} languagePack={languagePack} />
      {hasConversation && <h1 className="sr-only">Tumpang Guide</h1>}
      {!hasConversation && <section className="guide-hero" aria-labelledby="guide-hero-title"><div className="guide-hero__copy"><p className="guide-eyebrow">TUMPANG GUIDE</p><h1 id="guide-hero-title">{currentCopy.heroTitle}</h1><p>{currentCopy.heroDescription}</p><div className="guide-hero__trust"><span><IconCheck size={14} /> {currentCopy.databaseOnly}</span><span><IconClock size={14} /> {currentCopy.timeoutFallback}</span><span><IconShield size={14} /> {currentCopy.privacy}</span></div></div><div className="guide-hero__media" aria-hidden="true"><PlacePoster seed="tumpang-guide-hero" category={CATEGORY.NATURE} /><span><IconRoute size={18} /><strong>{currentCopy.heroMediaTitle}</strong><small>{currentCopy.heroMediaDescription}</small></span></div></section>}
      <div className={`guide-toolbar ${hasConversation ? 'is-active-chat' : ''}`}>
        <div className="guide-toolbar__brand"><span className="guide-trip-badge"><IconRoute size={18} /></span><strong>Tumpang Guide</strong></div>
        {languageBusy && <span className="guide-language-loading">{currentCopy.loadingLanguage}</span>}
        {latestResponse && <SourceBadge response={latestResponse} copy={currentCopy} />}
        <Button type="button" size="small" variant="secondary" onClick={() => setPlanOpen((value) => !value)} aria-expanded={planOpen}>{currentCopy.travelBrief}</Button>
        <Button type="button" size="small" variant="secondary" onClick={startNewChat}>{currentCopy.newChat}</Button>
        <Link to="/assistant/history">{currentCopy.pastPlans} <IconArrowRight size={14} /></Link>
      </div>
      <div className={`guide-layout ${planOpen ? '' : 'is-plan-closed'}`}>
        {planOpen && <PlanSummary plan={planState} copy={currentCopy} languagePack={languagePack} onChange={setPlanState} onUseLocation={useCurrentLocation} onSavePreferences={requestPreferenceSave} locationBusy={locationBusy} locationError={locationError} canSave={Boolean(user)} />}
        <section className="guide-chat" aria-label={`Tumpang Guide · ${currentCopy.smart}`}>
          <div ref={chatScrollRef} className="guide-chat__messages" aria-live="polite">
            {messages.map((message) => {
              if (message.role === 'user') return <article key={message.id} className="guide-message guide-message--user"><p>{message.text}</p></article>;
              const bubble = <AssistantBubble response={message.response} copy={currentCopy} language={language} languagePack={languagePack} unlimitedTurns={Boolean(user)} actionStates={actionStates} feedbackState={feedbackStates[message.response.traceId]} showQuickReplies={!busy && message.response.traceId === latestAssistantTrace} onQuickReply={(text) => send(text)} onAction={requestAction} onResponseAction={requestResponseAction} onFeedback={feedback} onRetry={retry} onLoadMore={loadMore} chatScrollRef={chatScrollRef} />;
              const isOldRecommendation = message.response.recommendations?.length > 0 && message.response.traceId !== latestRecommendationTrace;
              return <div key={message.id} className={`guide-batch ${message.response.recommendations?.length ? 'has-recommendations' : ''}`}>{isOldRecommendation ? <details><summary>{message.response.batchId ? `${currentCopy.batchLabel} · ${message.response.batchId.slice(-6)}` : currentCopy.smart}</summary>{bubble}</details> : bubble}</div>;
            })}
            {busy && <article className="guide-message guide-message--assistant"><div className="guide-avatar"><IconRoute size={17} /></div><div className="guide-message__content"><p className="guide-thinking"><span /> {currentCopy.thinking}</p></div></article>}
          </div>
          {notice && <p className="guide-notice" role="status">{notice}</p>}
           <form className="guide-composer" onSubmit={(event) => { event.preventDefault(); send(); }}><div className="guide-composer__header"><label htmlFor="guide-message">{currentCopy.composerLabel}</label></div><div className="guide-composer__input-row"><textarea id="guide-message" rows="2" maxLength="1200" value={draft} onChange={(event) => { voiceBaseDraftRef.current = event.target.value; voiceInterimRef.current = ''; setVoicePreview(''); setDraft(event.target.value); }} placeholder="" /><label className="guide-voice-language"><span className="sr-only">{spokenLanguageLabel(speechLanguage)}</span><select aria-label={spokenLanguageLabel(speechLanguage)} title={spokenLanguageLabel(speechLanguage)} value={speechLanguage} onChange={changeSpeechLanguage} disabled={speech.listening || speech.processing}>{GUIDE_SPEECH_LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><IconButton label={speech.listening ? currentCopy.stopVoice : currentCopy.startVoice} onClick={speech.listening ? speech.stop : startSpeech} disabled={!speech.supported || speech.processing}>{speech.listening ? <IconStop size={19} /> : <IconMicrophone size={19} />}</IconButton><IconButton label={currentCopy.sendMessage} variant="primary" type="submit" disabled={busy || !draft.trim()}><IconSend size={19} /></IconButton></div>{voicePreview && <small className="guide-voice-preview" aria-live="polite">{voicePreview}</small>}<small>{currentCopy.voiceNote}</small>{speech.error && <p className="guide-field-error" role="alert">{speech.error}</p>}{speech.cloudFallbackAvailable && !speech.listening && <button type="button" className="guide-text-action" onClick={speech.startCloudFallback} disabled={speech.processing}>{speech.fallbackRequired ? (currentCopy.voiceUseCloudFallback || 'Use Groq cloud transcription') : (currentCopy.voiceTryCloudFallback || 'Not happy with this? Try cloud transcription instead')}</button>}</form>
        </section>
      </div>
      <AdaptiveDialog open={Boolean(pendingAction)} onClose={() => setPendingAction(null)} title={pendingAction?.type === GUIDE_ACTION.REGISTER_RIDE_ALERT || pendingAction?.type === 'cancel_ride_alert' ? currentCopy.rideAlert : pendingAction?.type === GUIDE_ACTION.SAVE_PREFERENCES ? currentCopy.savePreferences : pendingAction?.type === GUIDE_ACTION.REQUEST_CATALOGUE ? currentCopy.requestCatalogue : currentCopy.saveInterest} description={currentCopy.actionConfirm} footer={<><Button variant="secondary" onClick={() => setPendingAction(null)}>{currentCopy.cancel}</Button><Button onClick={confirmAction}>{currentCopy.confirm}</Button></>}><p>{pendingAction?.type === GUIDE_ACTION.REGISTER_RIDE_ALERT || pendingAction?.type === 'cancel_ride_alert' ? formatCopy(currentCopy.rideAlertConfirm, { name: pendingAction?.recommendation?.place?.name, date: pendingAction?.planState?.startDate }, '') : pendingAction?.type === GUIDE_ACTION.SAVE_PREFERENCES ? formatCopy(currentCopy.preferenceConfirm, { categories: (pendingAction?.planState?.preferredCategories || []).map((category) => guideCategoryLabel(category, language, languagePack)).join(', ') }, '') : pendingAction?.type === GUIDE_ACTION.REQUEST_CATALOGUE ? currentCopy.catalogueQueued : formatCopy(currentCopy.saveInterestConfirm, { name: pendingAction?.recommendation?.place?.name, date: pendingAction?.planState?.startDate }, '')}</p></AdaptiveDialog>
    </main>
  );
}
