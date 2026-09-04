import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { TumpangGuideService } from '../../../business-logic/guide/TumpangGuideService.js';
import { GUIDE_ACTION } from '../../../business-logic/guide/constants.js';
import {
  guideCategoryLabel, guideCopy, guideReasonText, guideRoleLabel, guideTradeoffLabel
} from '../../../business-logic/guide/GuideLanguage.js';
import { Button } from '../ui/Button.jsx';
import { IconArrowRight, IconCar, IconMapPin } from '../icons.jsx';
import GuidePlaceImage from './GuidePlaceImage.jsx';

export default function GuideRecommendationCard({ recommendation, featured = false, batchId = null, language, languagePack, planState, actionState, onAction, chatScrollRef }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [photoShown, setPhotoShown] = useState(false);
  const { place } = recommendation;
  const whyStorageKey = `m6-guide-why:${batchId || 'unbatched'}:${place?.id || recommendation.placeId}`;
  const [whyOpen, setWhyOpen] = useState(() => {
    try { return sessionStorage.getItem(whyStorageKey) === 'open'; } catch { return false; }
  });
  const copy = guideCopy(language, languagePack);
  const reasons = recommendation.verifiedReasonCodes.map((code) => guideReasonText(code, place, planState, language, languagePack)).filter(Boolean);
  const lead = String(recommendation.personalizedReason || reasons[0] || '').trim();
  const personalizedWhy = String(recommendation.personalizedWhy || '').trim();
  const tradeoff = String(recommendation.personalizedTradeoff
    || guideTradeoffLabel(recommendation.tradeoffCode, language, languagePack)).trim();
  const interestActive = Boolean(actionState?.interest);
  const alertActive = Boolean(actionState?.alert);
  const findRide = () => navigate(DestinationDiscoveryService.buildPrefillUrl('search', place, {
    origin: planState.origin, travelDate: planState.startDate
  }));
  const openDetails = () => {
    const returnTo = `${location.pathname}${location.search}`;
    const guideRestoreScrollTop = Number(chatScrollRef?.current?.scrollTop) || 0;
    TumpangGuideService.saveDetailReason({ ...recommendation, batchId: batchId || recommendation.batchId }, planState, returnTo, languagePack);
    navigate(`/discover/${place.id}?date=${planState.startDate || ''}`, { state: { returnTo, guideRestoreScrollTop, fromGuide: true } });
  };
  const toggleWhy = () => setWhyOpen((open) => {
    const next = !open;
    try { sessionStorage.setItem(whyStorageKey, next ? 'open' : 'closed'); } catch { /* Optional UI state. */ }
    return next;
  });

  return (
    <article className={`guide-rec-card ${featured ? 'is-featured' : 'is-alternative'}`}>
      <div className="guide-rec-card__media">
        <GuidePlaceImage place={place} revealable copy={copy} onShownChange={setPhotoShown} />
        <span className="guide-rec-card__role">{guideRoleLabel(recommendation.role, language, languagePack)}</span>
        {recommendation.previouslyShown && <span className="guide-rec-card__repeat">{copy.previouslyShown}</span>}
        {photoShown && place.photoReferences?.[0]?.attribution && <span className="guide-rec-card__credit">{copy.photoCredit}: {place.photoReferences[0].attribution}</span>}
      </div>
      <div className="guide-rec-card__body">
        <div><h3>{place.name}</h3><p className="guide-rec-card__location"><IconMapPin size={14} /> {place.state} · {guideCategoryLabel(place.category, language, languagePack)}</p></div>
        {lead && <p className="guide-rec-card__lead">{lead}</p>}
        {whyOpen && <section className="guide-why" aria-label={`${copy.whyThis}: ${place.name}`}>
          <strong>{copy.whyThis}</strong>
          {personalizedWhy
            ? <p>{personalizedWhy}</p>
            : <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          <small>{copy.verifiedRules}</small>
        </section>}
        <p className="guide-rec-card__tradeoff"><strong>{copy.tradeoff}:</strong> {tradeoff}</p>
        <div className="guide-rec-card__actions">
          <Button size="small" variant={whyOpen ? 'secondary' : undefined} onClick={toggleWhy}>{copy.whyThis} {whyOpen ? '↑' : <IconArrowRight size={15} />}</Button>
          <Button size="small" variant="secondary" onClick={openDetails}>{copy.details}</Button>
        </div>
        <div className="guide-rec-card__secondary-actions">
          <button type="button" className="guide-text-action" onClick={findRide}><IconCar size={14} /> {copy.findRide}</button>
          <button type="button" className="guide-text-action" aria-pressed={interestActive} onClick={() => onAction(interestActive ? 'cancel_interest' : GUIDE_ACTION.RECORD_INTEREST, recommendation, planState)}>
            {interestActive ? `✓ ${copy.interestSaved} · ${copy.cancel}` : copy.saveInterest}
          </button>
          <button type="button" className="guide-text-action" aria-pressed={alertActive} onClick={() => onAction(alertActive ? 'cancel_ride_alert' : GUIDE_ACTION.REGISTER_RIDE_ALERT, recommendation, planState)}>
            {alertActive ? `✓ ${copy.alertSaved} · ${copy.cancel}` : copy.rideAlert}
          </button>
        </div>
      </div>
    </article>
  );
}
