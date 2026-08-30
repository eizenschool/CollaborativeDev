import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getCurrentLocationPreview } from '../../../business-logic/GooglePlacesService.js';
import { TumpangGuideService } from '../../../business-logic/guide/TumpangGuideService.js';
import { GUIDE_ACTION, GUIDE_CORE_LANGUAGES, GUIDE_LANGUAGE, GUIDE_STORAGE } from '../../../business-logic/guide/constants.js';
import {
  getInitialGuideLanguage, guideCategoryLabel, guideCopy, guideFallbackReasonLabel, guideFeedbackReasons,
  GUIDE_LANGUAGE_OPTIONS, guideReasonText, normalizeGuideLanguage
} from '../../../business-logic/guide/GuideLanguage.js';
import { normalizePlanState } from '../../../business-logic/guide/GuideIntentParser.js';
import { localizeGuideResponse, localizedDifferentPlacesCommand } from '../../../business-logic/guide/GuideResponseLocalization.js';
import { CATEGORY } from '../../../business-logic/discovery/constants.js';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { IconArrowRight, IconCheck, IconClock, IconMapPin, IconMicrophone, IconRoute, IconSend, IconShield, IconStop } from '../icons.jsx';
import GuideOnboarding from './GuideOnboarding.jsx';
import GuideRecommendationCard from './GuideRecommendationCard.jsx';
import PlacePoster from '../discover/PlacePoster.jsx';
import { useGuideSpeechInput } from './useGuideSpeechInput.js';

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
  const copy = guideCopy(language);
  const quickReplies = language === 'zh-CN' ? ['明天的自然日', '这个周末吃美食', '这个助手怎么用？']
    : language === 'ms' ? ['Hari alam esok', 'Makanan hujung minggu ini', 'Bagaimana ini berfungsi?']
      : language === 'ta' ? ['நாளை இயற்கை நாள்', 'இந்த வார இறுதி உணவு', 'இது எப்படி செயல்படும்?']
        : ['A nature day tomorrow', 'Food this weekend', 'How does this work?'];
  return { id: 'welcome', role: 'assistant', response: {
    mode: 'clarify', assistantMessage: copy.welcome, language, planState: normalizePlanState({ language }),
    quickReplies, recommendations: [], actions: [],
    remainingTurns: user ? 20 : 5, fallbackReason: null, source: 'rules', batchId: null, traceId: 'welcome'
  } };
};

function onboardingSeen() {
  try { return localStorage.getItem(GUIDE_STORAGE.ONBOARDING_KEY) === 'seen'; } catch { return false; }
}

function sessionStorageKey(visitorSessionId, userId, sessionId = null) {
  return `${GUIDE_STORAGE.SESSION_KEY}:${userId || visitorSessionId}:${sessionId || 'current'}`;
}

function legacySessionStorageKey(visitorSessionId, userId) {
  return `${GUIDE_STORAGE.SESSION_KEY}:${userId || visitorSessionId}`;
}

function readCurrentChat(visitorSessionId, userId, requestedSessionId = null) {
  const keys = [
    requestedSessionId ? sessionStorageKey(visitorSessionId, userId, requestedSessionId) : null,
    sessionStorageKey(visitorSessionId, userId),
    legacySessionStorageKey(visitorSessionId, userId)
  ].filter(Boolean);
  try {
    for (const key of [...new Set(keys)]) {
      const stored = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!stored?.messages?.length) continue;
      if (requestedSessionId && stored.sessionId !== requestedSessionId) continue;
      return stored;
    }
  } catch { /* Browser-private recovery is best effort. */ }
  return null;
}

function saveCurrentChat(visitorSessionId, userId, planState, messages, feedbackStates = {}, sessionId = null) {
  try {
    const value = JSON.stringify({ planState, messages, feedbackStates, sessionId });
    // Keep both the route-specific snapshot and the current-chat snapshot.
    // Returning from a Guide detail page may navigate to /assistant rather than
    // /assistant/session/:id, so both routes must be able to restore the same
    // recommendation batch without asking Gemini to recalculate it.
    sessionStorage.setItem(sessionStorageKey(visitorSessionId, userId, sessionId), value);
    if (sessionId) sessionStorage.setItem(sessionStorageKey(visitorSessionId, userId), value);
    if (sessionId && userId) TumpangGuideService.cacheSessionSummary({ userId, sessionId, planState, messages });
  } catch { /* Best Effort for browser-private state. */ }
}

function activeChatKey(visitorSessionId, userId, requestedSessionId) {
  return `${userId || visitorSessionId}:${requestedSessionId || 'current'}`;
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

function GuideLanguagePicker({ language, copy, disabled, onChange }) {
  const selected = GUIDE_LANGUAGE_OPTIONS.find((option) => option.value === language);
  const [query, setQuery] = useState(selected?.label || language);

  useEffect(() => { setQuery(GUIDE_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label || language); }, [language]);

  const choose = (value) => {
    const trimmed = String(value || '').trim();
    const option = GUIDE_LANGUAGE_OPTIONS.find((item) => item.value.toLowerCase() === trimmed.toLowerCase()
      || item.label.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    if (option) { setQuery(option.label); onChange(option.value); return; }
    if (/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/i.test(trimmed)) onChange(trimmed);
  };

  return <label className="guide-language-picker">{copy.guideLanguage}<input list="guide-language-options" aria-label={copy.guideLanguage} value={query} autoComplete="off" disabled={disabled} onChange={(event) => { setQuery(event.target.value); choose(event.target.value); }} /><datalist id="guide-language-options">{GUIDE_LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.label}>{option.value}</option>)}</datalist></label>;
}

function PlanSummary({ plan, copy, languagePack, onChange, onUseLocation, onSavePreferences, locationBusy, locationError, canSave }) {
  const patch = (value) => onChange(normalizePlanState({ ...plan, ...value }));
  const toggleCategory = (category) => {
    const selected = new Set(plan.preferredCategories);
    if (selected.has(category)) selected.delete(category); else selected.add(category);
    patch({ preferredCategories: [...selected] });
  };
  return (
    <aside className="guide-plan" aria-labelledby="guide-plan-title">
      <div className="guide-plan__heading"><div><p className="guide-eyebrow">{copy.livePlan}</p><h2 id="guide-plan-title">{copy.travelBrief}</h2></div><span className="guide-trip-badge" aria-hidden="true"><IconRoute size={22} /></span></div>
      <label>{copy.startingPoint}<input aria-label={copy.startingPoint} value={plan.origin?.label || ''} placeholder={copy.startingPointPlaceholder} onChange={(event) => patch({ origin: event.target.value ? { label: event.target.value } : null })} /></label>
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
  return <span className={`guide-source-badge ${response.source === 'gemini' ? 'is-gemini' : ''}`}><IconShield size={12} /> {response.source === 'gemini' ? copy.sourceGemini : copy.sourceRules}</span>;
}

function AssistantBubble({ response, copy, language, languagePack, actionStates, feedbackState, onAction, onResponseAction, onFeedback, onRetry, onLoadMore }) {
  const [negativeOpen, setNegativeOpen] = useState(false);
  // A verified rules fallback is still a Guide response the user can judge.
  // Excluding it made the feedback controls disappear exactly when the user
  // most needed to report a timeout, rate limit or provider failure.
  const canFeedback = ['clarify', 'recommend', 'help', 'fallback'].includes(response.mode) && response.traceId !== 'welcome';
  const selectedFeedback = feedbackState?.sentiment || null;
  return (
    <article className={`guide-message guide-message--assistant guide-message--${response.mode}`}>
      <div className="guide-avatar" aria-hidden="true"><IconRoute size={17} /></div>
      <div className="guide-message__content">
        <p>{response.localizedMessage || response.assistantMessage}</p>
        {response.mode === 'emergency' && <div className="guide-emergency-actions">{response.actions.map((action) => action.href?.startsWith('tel:') ? <a key={action.type} className="ui-button ui-button--danger ui-button--medium" href={action.href}>{action.label}</a> : <Link key={action.type} className="ui-button ui-button--secondary ui-button--medium" to={action.href}>{action.label}</Link>)}</div>}
        {response.mode === 'catalogue_missing' && response.actions?.length > 0 && <div className="guide-emergency-actions">{response.actions.map((action) => <Button key={`${action.type}:${action.requestedName}`} size="small" variant="secondary" onClick={() => onResponseAction(action)}>{action.label}</Button>)}</div>}
        {response.fallbackReason && <p className="guide-fallback-note"><IconShield size={14} /> {copy.rulesFallback} · {guideFallbackReasonLabel(response.fallbackReason, language, languagePack)}</p>}
        {response.fallbackReason && response.recommendations?.length > 0 && ['timeout', 'provider_429', 'provider_unavailable', 'gemini_disabled', 'invalid_json_shape', 'provider_changed_rule_batch'].includes(response.fallbackReason) && <Button size="small" variant="secondary" onClick={() => onRetry(response)} disabled={response.retrying}>{response.retrying ? copy.thinking : copy.retryGemini}</Button>}
        {response.recommendations?.length > 0 && <div className="guide-recommendations">{response.recommendations.map((recommendation) => <GuideRecommendationCard key={`${response.batchId || response.traceId}:${recommendation.placeId}`} recommendation={recommendation} batchId={response.batchId} language={language} languagePack={languagePack} planState={response.planState} actionState={actionStates[`${recommendation.placeId}:${response.planState?.startDate || ''}`]} onAction={onAction} />)}</div>}
        {response.mode === 'recommend' && response.recommendations?.length > 0 && response.recommendations.length < 3 && <button type="button" className="guide-text-action" onClick={onLoadMore}>{copy.showMore}</button>}
         <div className="guide-message__meta"><span>{copy.remaining(response.remainingTurns)}</span><SourceBadge response={response} copy={copy} />
           {canFeedback && <><button type="button" className={selectedFeedback === 'up' ? 'is-selected' : ''} onClick={() => onFeedback(response, selectedFeedback === 'up' ? 'clear' : 'up', 'helpful')}>{copy.helpful}</button><button type="button" className={selectedFeedback === 'down' ? 'is-selected' : ''} onClick={() => { if (selectedFeedback !== 'down') onFeedback(response, 'down', 'not_relevant'); setNegativeOpen((open) => !open); }}>{copy.notRelevant}</button>{negativeOpen && <select aria-label={copy.feedbackReason} value={selectedFeedback === 'down' ? (feedbackState.reason || 'not_relevant') : 'not_relevant'} onChange={(event) => { setNegativeOpen(false); onFeedback(response, 'down', event.target.value); }}><option value="">{copy.chooseFeedbackReason}</option>{guideFeedbackReasons(language, languagePack).map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select>}{selectedFeedback === 'down' && <button type="button" className="guide-feedback-clear" onClick={() => onFeedback(response, 'clear', 'not_relevant')}>×</button>}</>}
        </div>
      </div>
    </article>
  );
}

export default function TumpangGuidePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { sessionId: requestedSessionId } = useParams();
  const [visitorSessionId] = useState(createVisitorId);
  const [language, setLanguage] = useState(getInitialGuideLanguage);
  const [languagePack, setLanguagePack] = useState(null);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [languageLocked, setLanguageLocked] = useState(Boolean(typeof localStorage !== 'undefined' && localStorage.getItem(GUIDE_STORAGE.LANGUAGE_KEY)));
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
  const sessionRef = useRef(null);
  const loadedSessionRef = useRef(null);
  const currentCopy = useMemo(() => guideCopy(language, languagePack), [language, languagePack]);
  useEffect(() => {
    const normalized = normalizeGuideLanguage(language);
    if (GUIDE_CORE_LANGUAGES.includes(normalized)) {
      setLanguagePack(null);
      return undefined;
    }
    let active = true;
    setLanguageBusy(true);
    TumpangGuideService.getLanguagePack(normalized).then((pack) => {
      if (active) setLanguagePack(pack);
    }).catch(() => {
      if (!active) return;
      try { localStorage.removeItem(GUIDE_STORAGE.LANGUAGE_KEY); } catch { /* no-op */ }
      setLanguagePack(null);
      setLanguage(normalizeGuideLanguage('en'));
      setNotice(guideCopy('en').languageUnavailable);
    }).finally(() => { if (active) setLanguageBusy(false); });
    return () => { active = false; };
  }, [language]);
  useEffect(() => {
    if (!languagePack || GUIDE_CORE_LANGUAGES.includes(normalizeGuideLanguage(language))) return;
    setMessages((current) => current.map((message) => message.response
      ? { ...message, response: localizeGuideResponse(message.response, language, languagePack) }
      : message));
  }, [language, languagePack]);
  const transcript = useCallback((text) => setDraft((current) => current ? `${current} ${text}` : text), []);
  const interimTranscript = useCallback((text) => setDraft(text), []);
  const speech = useGuideSpeechInput({ language, copy: currentCopy, onTranscript: transcript, onInterim: interimTranscript });
  const latestResponse = useMemo(() => [...messages].reverse().find((message) => message.response)?.response, [messages]);
  const shownPlaceIds = useMemo(() => messages.flatMap((message) => (message.response?.recommendations || []).map((recommendation) => recommendation.placeId)), [messages]);

  useEffect(() => {
    const key = activeChatKey(visitorSessionId, user?.id, requestedSessionId);
    setChatHydrationKey(null);
    if (!requestedSessionId) loadedSessionRef.current = null;
    if (requestedSessionId && !user?.id) return undefined;

    let active = true;
    if (requestedSessionId) {
      // Include the owner in the guard. A user can sign out and another user
      // can open the same URL in the same tab; never reuse the previous
      // account's already-hydrated messages in that case.
      const loadKey = `${user.id}:${requestedSessionId}`;
      if (loadedSessionRef.current === loadKey) return undefined;
      loadedSessionRef.current = loadKey;
      // Do not leave the previous conversation visible while another owner's
      // session is being loaded. This also prevents a failed history request
      // from looking like a successful restore of the wrong chat.
      setMessages([]);
      setPlanState(normalizePlanState({ language }));
      setFeedbackStates({});
      setBusy(true);
      const restoreCachedSession = () => {
        const stored = readCurrentChat(visitorSessionId, user.id, requestedSessionId);
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
        if (!active) return;
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
        if (!active) return;
        if (!restoreCachedSession()) setNotice(currentCopy.plansUnavailable || 'This saved plan could not be loaded.');
        setChatHydrationKey(key);
      }).finally(() => { if (active) setBusy(false); });
    } else {
      sessionRef.current = null;
      const stored = readCurrentChat(visitorSessionId, user?.id);
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
    return () => { active = false; };
  }, [requestedSessionId, user?.id, visitorSessionId]);

  useEffect(() => {
    const key = activeChatKey(visitorSessionId, user?.id, requestedSessionId);
    if (chatHydrationKey !== key) return;
    const currentSessionId = requestedSessionId || sessionRef.current?.id || null;
    saveCurrentChat(visitorSessionId, user?.id, planState, messages, feedbackStates, currentSessionId);
  }, [requestedSessionId, visitorSessionId, user?.id, chatHydrationKey, planState, messages, feedbackStates]);

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

  const send = async (text = draft, { replaceTraceId = null, retry = false } = {}) => {
    const clean = String(text || '').trim();
    if (!clean || busy) return;
    const session = ensureSession();
    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: clean };
    const nextMessages = replaceTraceId ? messages : [...messages, userMessage];
    setMessages(nextMessages); setDraft(''); setBusy(true); setNotice('');
    try {
      const response = await TumpangGuideService.sendTurn({
        user, sessionId: session?.id, visitorSessionId, text: clean, language, planState: retry ? (messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.planState || planState) : planState,
        messages: nextMessages.map((message) => message.response ? { role: 'assistant', text: message.localizedMessage || message.response.assistantMessage } : message),
        shownPlaceIds: retry ? shownPlaceIds.filter((id) => !(messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.recommendations || []).some((item) => item.placeId === id)) : shownPlaceIds,
        languageLocked, online: navigator.onLine,
        retryBatchId: retry ? messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.batchId : null,
        retryPlaceIds: retry ? (messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.recommendations || []).map((item) => item.placeId) : [],
        retryRecommendations: retry ? (messages.find((item) => item.response?.traceId === replaceTraceId)?.response?.recommendations || []).map(({ placeId, role, verifiedReasonCodes, tradeoffCode }) => ({ placeId, role, verifiedReasonCodes, tradeoffCode })) : []
      });
      const localizedResponse = localizeGuideResponse(response, language, languagePack);
      const decorated = { ...localizedResponse, promptText: clean, retrying: false, recommendations: (localizedResponse.recommendations || []).map((item) => ({ ...item, batchId: localizedResponse.batchId })) };
      setPlanState(normalizePlanState(response.planState));
      if (response.sessionId) {
        sessionRef.current = { id: response.sessionId, userId: user?.id || null };
      }
      if (response.persistenceWarning) setNotice(currentCopy.persistenceWarning);
      setMessages((current) => replaceTraceId
        ? current.map((message) => message.response?.traceId === replaceTraceId ? { ...message, response: decorated, id: response.traceId } : message)
        : [...current, { id: response.traceId, role: 'assistant', response: decorated }]);
    } catch { setNotice(currentCopy.retryNotice); }
    finally { setBusy(false); }
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
    send(promptText, { replaceTraceId: response.traceId, retry: true });
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

  const changeLanguage = async (nextValue) => {
    const next = normalizeGuideLanguage(nextValue); setLanguageBusy(true); setNotice('');
    try {
      let pack = null;
      if (!GUIDE_CORE_LANGUAGES.includes(next)) pack = await TumpangGuideService.getLanguagePack(next);
      setLanguage(next); setLanguagePack(pack); setLanguageLocked(true); setPlanState((current) => normalizePlanState({ ...current, language: next }));
      try { localStorage.setItem(GUIDE_STORAGE.LANGUAGE_KEY, next); } catch { /* no-op */ }
      const assistantRows = messages
        .filter((message) => message.response && message.response.traceId !== 'welcome'
          && (message.response.mode === 'help' || message.response.source === 'gemini'))
        .map((message) => ({ id: message.response.traceId, text: message.response.assistantMessage }));
      let translated = {};
      try {
        translated = assistantRows.length
          ? await TumpangGuideService.translateMessages({ user, sessionId: sessionRef.current?.id, visitorSessionId, language: next, messages: assistantRows }) : {};
      } catch {
        // Pack/template localization remains available even when an old free-form
        // Help or Gemini explanation cannot be translated at this moment.
      }
      setMessages((current) => current.map((message) => {
        if (!message.response) return message;
        const localized = localizeGuideResponse(message.response, next, pack);
        return translated[message.response.traceId]
          ? { ...message, response: { ...localized, localizedMessage: translated[message.response.traceId], localizedMessages: { ...(message.response.localizedMessages || {}), [next]: translated[message.response.traceId] } } }
          : { ...message, response: localized };
      }));
    } catch { setLanguage('en'); setLanguagePack(null); setPlanState((current) => normalizePlanState({ ...current, language: GUIDE_LANGUAGE.ENGLISH })); setNotice(guideCopy(GUIDE_LANGUAGE.ENGLISH).languageUnavailable); }
    finally { setLanguageBusy(false); }
  };

  const useLocation = async () => { setLocationBusy(true); setLocationError(''); try { const point = await getCurrentLocationPreview(); setPlanState((current) => normalizePlanState({ ...current, origin: { label: 'Current location', lat: point.latitude, lng: point.longitude } })); } catch { setLocationError(currentCopy.actionFailed); } finally { setLocationBusy(false); } };

  const requestAction = (type, recommendation, cardPlan) => {
    if (!user) { navigate('/auth', { state: { from: '/assistant', reason: 'Sign in before saving a Tumpang Guide action.' } }); return; }
    setPendingAction({ type, recommendation, planState: cardPlan, actionState: actionStates[`${recommendation.placeId}:${cardPlan.startDate || ''}`] });
  };
  const requestPreferenceSave = () => { if (!user) { navigate('/auth', { state: { from: '/assistant', reason: 'Sign in before saving travel preferences.' } }); return; } setPendingAction({ type: GUIDE_ACTION.SAVE_PREFERENCES, planState }); };
  const requestResponseAction = (action) => { if (action.type !== GUIDE_ACTION.REQUEST_CATALOGUE) return; if (!user) { navigate('/auth', { state: { from: '/assistant', reason: 'Sign in before requesting a catalogue review.' } }); return; } setPendingAction({ type: action.type, requestedName: action.requestedName, planState }); };
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
      <section className="guide-hero" aria-labelledby="guide-hero-title"><div className="guide-hero__copy"><p className="guide-eyebrow">TUMPANG GUIDE</p><h1 id="guide-hero-title">{currentCopy.heroTitle}</h1><p>{currentCopy.heroDescription}</p><div className="guide-hero__trust"><span><IconCheck size={14} /> {currentCopy.databaseOnly}</span><span><IconClock size={14} /> {currentCopy.timeoutFallback}</span><span><IconShield size={14} /> {currentCopy.privacy}</span></div><div className="guide-hero__actions"><Button type="button" onClick={startNewChat}>{currentCopy.newChat}</Button><Link to="/assistant/history">{currentCopy.pastPlans} <IconArrowRight size={14} /></Link></div></div><div className="guide-hero__media" aria-hidden="true"><PlacePoster seed="tumpang-guide-hero" category={CATEGORY.NATURE} /><span><IconRoute size={18} /><strong>{currentCopy.heroMediaTitle}</strong><small>{currentCopy.heroMediaDescription}</small></span></div></section>
      <div className="guide-toolbar"><GuideLanguagePicker language={language} copy={currentCopy} onChange={changeLanguage} disabled={languageBusy} />{languageBusy && <span className="guide-language-loading">{currentCopy.loadingLanguage}</span>}<span className="guide-mode-pill smart">{currentCopy.smart}</span><Button type="button" size="small" variant="secondary" onClick={startNewChat}>{currentCopy.newChat}</Button><Link to="/assistant/history">{currentCopy.pastPlans} <IconArrowRight size={14} /></Link></div>
      <div className="guide-layout"><PlanSummary plan={planState} copy={currentCopy} languagePack={languagePack} onChange={setPlanState} onUseLocation={useLocation} onSavePreferences={requestPreferenceSave} locationBusy={locationBusy} locationError={locationError} canSave={Boolean(user)} /><section className="guide-chat" aria-label={currentCopy.composerLabel}><div className="guide-chat__messages" aria-live="polite">{messages.map((message, index) => message.role === 'user' ? <article key={message.id} className="guide-message guide-message--user"><p>{message.text}</p></article> : <div key={message.id} className={`guide-batch ${message.response.recommendations?.length ? 'has-recommendations' : ''}`}><details open={!message.response.recommendations?.length || index === messages.length - 1}>{message.response.recommendations?.length > 0 && <summary>{message.response.batchId ? `${currentCopy.batchLabel} · ${message.response.batchId.slice(-6)}` : currentCopy.smart}</summary>}<AssistantBubble response={message.response} copy={currentCopy} language={language} languagePack={languagePack} actionStates={actionStates} feedbackState={feedbackStates[message.response.traceId]} onAction={requestAction} onResponseAction={requestResponseAction} onFeedback={feedback} onRetry={retry} onLoadMore={loadMore} /></details></div>)}{busy && <article className="guide-message guide-message--assistant"><div className="guide-avatar"><IconRoute size={17} /></div><div className="guide-message__content"><p className="guide-thinking"><span /> {currentCopy.thinking}</p></div></article>}</div>{latestResponse?.quickReplies?.length > 0 && <div className="guide-quick-replies" aria-label={currentCopy.suggestedReplies}>{latestResponse.quickReplies.map((reply) => <button type="button" key={reply} onClick={() => send(reply)} disabled={busy}>{reply}</button>)}</div>}{notice && <p className="guide-notice" role="status">{notice}</p>}<form className="guide-composer" onSubmit={(event) => { event.preventDefault(); send(); }}><div className="guide-composer__header"><label htmlFor="guide-message">{currentCopy.composerLabel}</label><Button type="button" size="small" variant="secondary" onClick={startNewChat}>{currentCopy.newChat}</Button></div><div><textarea id="guide-message" rows="2" maxLength="1200" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={currentCopy.composerPlaceholder} /><IconButton label={speech.listening ? currentCopy.stopVoice : currentCopy.startVoice} onClick={speech.listening ? speech.stop : speech.start} disabled={!speech.supported}>{speech.listening ? <IconStop size={19} /> : <IconMicrophone size={19} />}</IconButton><IconButton label={currentCopy.sendMessage} variant="primary" type="submit" disabled={busy || !draft.trim()}><IconSend size={19} /></IconButton></div><small>{currentCopy.voiceNote}</small>{speech.error && <p className="guide-field-error" role="alert">{speech.error}</p>}</form></section></div>
      <AdaptiveDialog open={Boolean(pendingAction)} onClose={() => setPendingAction(null)} title={pendingAction?.type === GUIDE_ACTION.REGISTER_RIDE_ALERT || pendingAction?.type === 'cancel_ride_alert' ? currentCopy.rideAlert : pendingAction?.type === GUIDE_ACTION.SAVE_PREFERENCES ? currentCopy.savePreferences : pendingAction?.type === GUIDE_ACTION.REQUEST_CATALOGUE ? currentCopy.requestCatalogue : currentCopy.saveInterest} description={currentCopy.actionConfirm} footer={<><Button variant="secondary" onClick={() => setPendingAction(null)}>{currentCopy.cancel}</Button><Button onClick={confirmAction}>{currentCopy.confirm}</Button></>}><p>{pendingAction?.type === GUIDE_ACTION.REGISTER_RIDE_ALERT || pendingAction?.type === 'cancel_ride_alert' ? formatCopy(currentCopy.rideAlertConfirm, { name: pendingAction?.recommendation?.place?.name, date: pendingAction?.planState?.startDate }, '') : pendingAction?.type === GUIDE_ACTION.SAVE_PREFERENCES ? formatCopy(currentCopy.preferenceConfirm, { categories: (pendingAction?.planState?.preferredCategories || []).map((category) => guideCategoryLabel(category, language, languagePack)).join(', ') }, '') : pendingAction?.type === GUIDE_ACTION.REQUEST_CATALOGUE ? currentCopy.catalogueQueued : formatCopy(currentCopy.saveInterestConfirm, { name: pendingAction?.recommendation?.place?.name, date: pendingAction?.planState?.startDate }, '')}</p></AdaptiveDialog>
    </main>
  );
}
