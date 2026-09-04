import { GUIDE_MODEL } from '../../../business-logic/guide/constants.js';

const LANGUAGE_SCENARIOS = Object.freeze({
  en: { label: 'English', text: 'Two people from Kuala Lumpur want nature tomorrow' },
  'zh-CN': { label: '简体中文', text: '明天 2 人从吉隆坡出发想去自然景点' },
  ms: { label: 'Bahasa Melayu', text: '2 orang dari Kuala Lumpur mahu alam esok' },
  ta: { label: 'Tamil', text: 'நாளை Kuala Lumpur இருந்து 2 பேர் இயற்கை இடம் வேண்டும்' }
});

export default function GuideQaConsole({ value, onChange, onLoadScenario, trace }) {
  const patch = (next) => onChange({ ...value, ...next });
  const scenario = LANGUAGE_SCENARIOS[value.scenario] || LANGUAGE_SCENARIOS.en;
  const candidateIds = (trace?.recommendations || []).map((item) => item.placeId);
  return (
    <details className="guide-qa">
      <summary>QA Console · controlled environment</summary>
      <div className="guide-qa__grid">
        <label>Language scenario<select value={value.scenario || 'en'} onChange={(event) => patch({ scenario: event.target.value })}>{Object.entries(LANGUAGE_SCENARIOS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select></label>
        <label>Date override<input type="date" value={value.today || ''} onChange={(event) => patch({ today: event.target.value })} /></label>
        <label>Weather<select value={value.weather || 'live'} onChange={(event) => patch({ weather: event.target.value })}><option value="live">Normal rules</option><option value="clear">Clear</option><option value="advisory">Advisory</option><option value="severe">Severe</option></select></label>
        <label>Simulated latency<select value={value.latencyMs || 0} onChange={(event) => patch({ latencyMs: Number(event.target.value) })}><option value="0">0 ms</option><option value="800">800 ms</option><option value="10000">10 s timeout edge</option></select></label>
        <label>Fallback<select value={value.forceFallback || ''} onChange={(event) => patch({ forceFallback: event.target.value })}><option value="">Off</option><option value="offline">Offline rules</option><option value="provider_429">Provider 429</option><option value="invalid_json">Invalid JSON</option><option value="timeout">Timeout</option></select></label>
      </div>
      <button type="button" className="guide-location-button" onClick={() => onLoadScenario(value.scenario || 'en', scenario.text)}>Load language scenario</button>
      <label className="guide-qa__check"><input type="checkbox" checked={Boolean(value.rejectUnknownPlace)} onChange={(event) => patch({ rejectUnknownPlace: event.target.checked })} /> Inject a database-external Place ID and verify rejection</label>
      <dl className="guide-qa__trace"><div><dt>Prompt</dt><dd>{GUIDE_MODEL.PROMPT_VERSION}</dd></div><div><dt>Model</dt><dd>{GUIDE_MODEL.GENERATION}</dd></div><div><dt>Trace</dt><dd>{trace?.traceId || 'Not run'}</dd></div><div><dt>Latency</dt><dd>{Number.isFinite(trace?.qaLatencyMs) ? `${trace.qaLatencyMs} ms` : 'Not run'}</dd></div><div><dt>Candidate IDs</dt><dd>{candidateIds.join(', ') || 'None'}</dd></div><div><dt>Fallback</dt><dd>{trace?.fallbackReason || 'None'}</dd></div><div><dt>Rejected ID</dt><dd>{trace?.validation?.rejectedPlaceId || 'None'}</dd></div></dl>
    </details>
  );
}
