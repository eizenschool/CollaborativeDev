import { useLocation, useNavigate } from 'react-router-dom';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { TumpangGuideService } from '../../../business-logic/guide/TumpangGuideService.js';
import { guideCategoryLabel } from '../../../business-logic/guide/GuideLanguage.js';
import { Button } from '../ui/Button.jsx';
import { IconArrowRight, IconCar, IconClock, IconMapPin, IconShield } from '../icons.jsx';
import GuidePlaceImage from './GuidePlaceImage.jsx';

export default function GuidePlaceSpotlight({ placeInfo, planState, copy, language, languagePack, chatScrollRef }) {
  const navigate = useNavigate(); const location = useLocation();
  const place = placeInfo?.place;
  if (!place) return null;
  const openDetails = () => {
    const returnTo = `${location.pathname}${location.search}`;
    const guideRestoreScrollTop = Number(chatScrollRef?.current?.scrollTop) || 0;
    TumpangGuideService.saveDetailReason({
      placeId: place.id, role: 'best_match', verifiedReasonCodes: [], tradeoffCode: 'none'
    }, planState, returnTo);
    navigate(`/discover/${place.id}?date=${planState?.startDate || ''}`, { state: { returnTo, guideRestoreScrollTop, fromGuide: true } });
  };
  const findRide = () => navigate(DestinationDiscoveryService.buildPrefillUrl('search', place, {
    origin: planState?.origin, travelDate: planState?.startDate
  }));
  const checked = placeInfo.checkedAt ? new Intl.DateTimeFormat(language || 'en', {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(placeInfo.checkedAt)) : null;
  const expectedStay = Number(placeInfo.typicalVisitMinutes) > 0
    ? new Intl.NumberFormat(language || 'en', { style: 'unit', unit: 'minute', unitDisplay: 'long' })
      .format(Number(placeInfo.typicalVisitMinutes)) : null;

  return <article className="guide-spotlight" aria-labelledby={`guide-place-${place.id}`}>
    <div className="guide-spotlight__media"><GuidePlaceImage place={place} revealable copy={copy} /></div>
    <div className="guide-spotlight__content">
      <div className="guide-spotlight__heading">
        <div><span className="guide-spotlight__eyebrow"><IconShield size={13} /> {placeInfo.sourceStatus === 'live' ? copy.livePlaceInfo : copy.databasePlaceInfo}</span>
          <h3 id={`guide-place-${place.id}`}>{place.name}</h3>
          <p><IconMapPin size={15} /> {place.state} · {guideCategoryLabel(place.category, language, languagePack)}</p></div>
      </div>
      <p className="guide-spotlight__summary">{placeInfo.summary}</p>
      {placeInfo.highlights?.length > 0 && <section><h4>{copy.placeHighlights}</h4><ul>{placeInfo.highlights.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      <div className="guide-spotlight__columns">
        {expectedStay && <section><h4>{copy.expectedStay}</h4><p>{expectedStay}</p></section>}
        {placeInfo.audience?.length > 0 && <section><h4>{copy.goodFor}</h4><ul>{placeInfo.audience.map((item) => <li key={item}>{item}</li>)}</ul></section>}
        {placeInfo.practicalNotes?.length > 0 && <section><h4>{copy.practicalNotes}</h4><ul>{placeInfo.practicalNotes.map((item) => <li key={item}>{item}</li>)}</ul></section>}
      </div>
      <div className="guide-spotlight__actions">
        <Button size="small" onClick={openDetails}>{copy.details} <IconArrowRight size={15} /></Button>
        <Button size="small" variant="secondary" onClick={findRide}><IconCar size={15} /> {copy.findRide}</Button>
      </div>
      <details className="guide-spotlight__sources">
        <summary>{copy.sourceLabel}{placeInfo.sources?.length ? ` (${placeInfo.sources.length})` : ''}</summary>
        {checked && <p><IconClock size={13} /> {copy.checkedAt}: {checked}</p>}
        {placeInfo.sources?.length > 0 ? <ol>{placeInfo.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ol> : <p>{copy.liveInfoUnavailable}</p>}
      </details>
    </div>
  </article>;
}
