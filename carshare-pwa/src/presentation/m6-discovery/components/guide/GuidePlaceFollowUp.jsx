// ===== PRESENTATION LAYER (GuidePlaceFollowUp) =====
// A lightweight answer for a detail question about a place already
// introduced earlier in this conversation (see index.ts's placeInfo.followUp
// - it is true once the same placeId has appeared as either a place_info
// spotlight or a recommendation card). Plain chat text, not another
// GuidePlaceSpotlight card: the image, heading and action buttons were
// already shown once and do not need repeating for a follow-up question.
// Source citation is kept, since the underlying fact is still a live,
// web-grounded claim that must stay verifiable.
export default function GuidePlaceFollowUp({ placeInfo, copy }) {
  if (!placeInfo) return null;
  return (
    <div className="guide-place-followup">
      {placeInfo.summary && <p className="guide-place-followup__summary">{placeInfo.summary}</p>}
      {placeInfo.highlights?.length > 0 && (
        <ul className="guide-place-followup__list">
          {placeInfo.highlights.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {placeInfo.practicalNotes?.length > 0 && (
        <ul className="guide-place-followup__list">
          {placeInfo.practicalNotes.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {placeInfo.sources?.length > 0 && (
        <p className="guide-place-followup__sources">
          {copy.sourceLabel}:{' '}
          {placeInfo.sources.map((source, index) => (
            <span key={source.url}>
              {index > 0 && ', '}
              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
