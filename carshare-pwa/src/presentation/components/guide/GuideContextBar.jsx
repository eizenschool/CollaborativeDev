// ===== PRESENTATION LAYER (GuideContextBar) =====
// Replaces the former "Your travel brief" sidebar. That panel stayed open by
// default beside the chat on every viewport, and on phone it pushed the whole
// conversation below the fold - see docs/ai/DECISIONS.md. Everything it did
// (starting point, dates, party size, category preferences, trip-history
// consent, saving preferences) still exists; it now lives in one summary row
// above the composer that opens the same fields in the shared AdaptiveDialog
// (a bottom sheet on phone, a centred dialog on wider layouts) instead of
// occupying a permanent column.
import { useRef, useState } from 'react';
import { normalizePlanState } from '../../../business-logic/guide/GuideIntentParser.js';
import { guideCategoryLabel } from '../../../business-logic/guide/GuideLanguage.js';
import { CATEGORY } from '../../../business-logic/discovery/constants.js';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import { IconEdit, IconMapPin } from '../icons.jsx';
import ConfirmedLocationInput from '../maps/ConfirmedLocationInput.jsx';

function formatDateRange(plan, copy) {
  if (!plan.startDate) return copy.dateNotDecided;
  const start = new Date(`${plan.startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return copy.dateNotDecided;
  const startLabel = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (!plan.endDate || plan.endDate === plan.startDate) return startLabel;
  const end = new Date(`${plan.endDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return startLabel;
  return `${startLabel} – ${end.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

function summaryParts(plan, copy, language, languagePack) {
  const parts = [plan.origin?.label || copy.originNotDecided, formatDateRange(plan, copy)];
  if (plan.partySize) parts.push(`${plan.partySize} ${copy.people}`);
  if (plan.preferredCategories?.length) {
    parts.push(plan.preferredCategories.map((category) => guideCategoryLabel(category, language, languagePack)).join(', '));
  }
  return parts;
}

export default function GuideContextBar({
  plan, copy, language, languagePack, onChange, onUseLocation, onSavePreferences, locationBusy, locationError, canSave
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

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
    <>
      <button
        type="button"
        ref={triggerRef}
        className="guide-context-bar"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <IconMapPin size={15} aria-hidden="true" className="guide-context-bar__icon" />
        <span className="guide-context-bar__values">{summaryParts(plan, copy, language, languagePack).join(' · ')}</span>
        <span className="guide-context-bar__edit"><IconEdit size={14} aria-hidden="true" /> <span className="sr-only">{copy.travelBrief}</span></span>
      </button>

      <AdaptiveDialog
        open={open}
        onClose={() => setOpen(false)}
        title={copy.travelBrief}
        triggerRef={triggerRef}
      >
        <div className="guide-plan-fields">
          <ConfirmedLocationInput
            id="guide-starting-point"
            label={copy.startingPoint}
            placeholder={copy.startingPointPlaceholder}
            value={plan.origin?.label || ''}
            location={originLocation}
            onChange={updateOrigin}
          />
          <button className="guide-location-button" type="button" onClick={onUseLocation} disabled={locationBusy}>
            <IconMapPin size={16} /> {locationBusy ? copy.locating : copy.useLocation}
          </button>
          {locationError && <p className="guide-field-error" role="alert">{locationError}</p>}
          <div className="guide-plan__row">
            <label>{copy.from}<input aria-label={copy.from} type="date" value={plan.startDate || ''} onChange={(event) => patch({ startDate: event.target.value, endDate: event.target.value })} /></label>
            <label>{copy.until}<input aria-label={copy.until} type="date" min={plan.startDate || undefined} value={plan.endDate || ''} onChange={(event) => patch({ endDate: event.target.value })} /></label>
          </div>
          <label>{copy.people}<input aria-label={copy.people} type="number" min="1" max="20" inputMode="numeric" value={plan.partySize || ''} onChange={(event) => patch({ partySize: Number(event.target.value) || null })} /></label>
          <fieldset>
            <legend>{copy.categoryQuestion}</legend>
            <div className="guide-category-chips">
              {Object.values(CATEGORY).map((category) => (
                <button
                  key={category}
                  type="button"
                  className={plan.preferredCategories.includes(category) ? 'active' : ''}
                  aria-pressed={plan.preferredCategories.includes(category)}
                  onClick={() => toggleCategory(category)}
                >
                  {guideCategoryLabel(category, plan.language, languagePack)}
                </button>
              ))}
            </div>
          </fieldset>
          <Button type="button" size="small" variant="secondary" onClick={onSavePreferences} disabled={!plan.preferredCategories.length}>
            {canSave ? copy.savePreferences : copy.signInSave}
          </Button>
          <label className="guide-consent">
            <input type="checkbox" checked={plan.tripHistoryConsent} onChange={(event) => patch({ tripHistoryConsent: event.target.checked })} />
            <span><strong>{copy.historyConsent}</strong><small>{copy.historyNote}</small></span>
          </label>
        </div>
      </AdaptiveDialog>
    </>
  );
}
