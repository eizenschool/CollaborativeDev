// ===== PRESENTATION LAYER (GuidePlaceFollowUp) =====
// A lightweight answer for a detail question about a catalogue place. Plain
// chat text, not another GuidePlaceSpotlight card: the image, heading and
// action buttons belong to recommendation/detail contexts, while this branch
// keeps the answer itself readable in the transcript.
// Source citation is kept, since the underlying fact is still a live,
// web-grounded claim that must stay verifiable.
export default function GuidePlaceFollowUp({ placeInfo, copy }) {
  if (!placeInfo) return null;
  const clean = (value) => String(value || '')
    .replace(/^\s*#{1,6}\s*/gmu, '')
    .replace(/\*{1,3}/gu, '')
    .replace(/^\s*[-*]\s+/gmu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
  const summary = clean(placeInfo.answer || placeInfo.summary);
  const highlights = (placeInfo.highlights || []).map(clean).filter(Boolean);
  const practicalNotes = (placeInfo.practicalNotes || []).map(clean).filter(Boolean);
  return (
    <div className="guide-place-followup">
      {placeInfo.officialName && <strong className="guide-place-followup__name">{placeInfo.officialName}</strong>}
      {summary && <p className="guide-place-followup__summary">{summary}</p>}
      {highlights.length > 0 && (
        <ul className="guide-place-followup__list">
          {highlights.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {practicalNotes.length > 0 && (
        <ul className="guide-place-followup__list">
          {practicalNotes.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {(placeInfo.sources?.length > 0 || placeInfo.checkedAt) && (
        <details className="guide-place-followup__sources">
          <summary>{copy.sourceChecked || 'Sources and checked time'}</summary>
          {placeInfo.checkedAt && <p>{copy.checkedAt || 'Checked'}: {new Date(placeInfo.checkedAt).toLocaleString()}</p>}
          {placeInfo.sources?.length > 0 && <ul>{placeInfo.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>}
        </details>
      )}
    </div>
  );
}
