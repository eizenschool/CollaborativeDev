import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { TumpangGuideService } from '../../../business-logic/guide/TumpangGuideService.js';
import { GUIDE_QA_MODE } from '../../../business-logic/guide/constants.js';
import { normalizePlanState } from '../../../business-logic/guide/GuideIntentParser.js';
import { Button } from '../ui/Button.jsx';
import { AsyncState, PageHeader, PageShell } from '../ui/Primitives.jsx';
import { IconArrowLeft } from '../icons.jsx';
import GuideQaConsole from './GuideQaConsole.jsx';

const QA_VISITOR_ID = `qa-${globalThis.crypto?.randomUUID?.() || Date.now()}`;

export default function GuideQaPage() {
  const { user } = useAuth();
  const [value, setValue] = useState({
    scenario: 'en', weather: 'live', latencyMs: 0, forceFallback: '',
    rejectUnknownPlace: false, today: ''
  });
  const [text, setText] = useState('Two people from Kuala Lumpur want nature tomorrow');
  const [trace, setTrace] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(null);

  if (!GUIDE_QA_MODE) {
    return <PageShell className="guide-page"><AsyncState title="QA Console is not available here"><p>This controlled route is enabled only for local development or an explicitly approved QA build.</p></AsyncState></PageShell>;
  }

  const run = async () => {
    if (!text.trim() || busy) return;
    if (user && !sessionRef.current) {
      sessionRef.current = TumpangGuideService.createSession(user, value.scenario, normalizePlanState({ language: value.scenario, tripHistoryConsent: false }));
    }
    setBusy(true); setError('');
    try {
      const response = await TumpangGuideService.sendTurn({
        user, sessionId: sessionRef.current, visitorSessionId: QA_VISITOR_ID,
        text, planState: normalizePlanState({ language: value.scenario, tripHistoryConsent: false }),
        messages: [], shownPlaceIds: [], languageLocked: true, qa: value,
        online: typeof navigator === 'undefined' ? true : navigator.onLine
      });
      if (response.sessionId) sessionRef.current = response.sessionId;
      setTrace(response);
    } catch (caught) { setError(caught.message || 'The QA turn failed.'); }
    finally { setBusy(false); }
  };

  const loadScenario = (language, scenarioText) => {
    setValue((current) => ({ ...current, scenario: language }));
    setText(scenarioText);
  };

  return <PageShell className="guide-page">
    <Link className="guide-back" to="/assistant"><IconArrowLeft size={16} /> Back to Tumpang Guide</Link>
    <PageHeader title="Tumpang Guide QA" eyebrow="Controlled environment">These controls exercise the real Edge Function contract. They never grant production users a way to change policy or choose a Gemini key.</PageHeader>
    <GuideQaConsole value={value} onChange={setValue} onLoadScenario={loadScenario} trace={trace} />
    <section className="guide-qa-runner" aria-label="QA request runner">
      <label>Message to send<textarea value={text} maxLength={1200} rows="4" onChange={(event) => setText(event.target.value)} /></label>
      <Button onClick={run} disabled={busy || !text.trim()}>{busy ? 'Running…' : 'Run controlled turn'}</Button>
      {error && <p className="guide-field-error" role="alert">{error}</p>}
      {trace && <pre className="guide-qa-result">{JSON.stringify(trace, null, 2)}</pre>}
    </section>
  </PageShell>;
}
