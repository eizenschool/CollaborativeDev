// ===== PRESENTATION LAYER (GuideContextBar) =====
// Replaces the former "Your travel brief" sidebar. That panel stayed open by
// default beside the chat on every viewport, and on phone it pushed the whole
// conversation below the fold - see docs/ai/DECISIONS.md. Everything it did
// (starting point, dates, party size, category preferences, trip-history
// consent, saving preferences) still exists; it now lives in one summary row
// above the composer that opens the same fields in the shared AdaptiveDialog
// (a bottom sheet on phone, a centred dialog on wider layouts) instead of
// occupying a permanent column.
import { useEffect, useRef, useState } from 'react';
import { normalizePlanState } from '../../../../business-logic/m6-discovery/guide/GuideIntentParser.js';
import { guideCategoryLabel } from '../../../../business-logic/m6-discovery/guide/GuideLanguage.js';
import { CATEGORY } from '../../../../business-logic/m6-discovery/discovery/constants.js';
import AdaptiveDialog from '../../../shared/components/ui/AdaptiveDialog.jsx';
import { Button } from '../../../shared/components/ui/Button.jsx';
import { IconEdit, IconMapPin } from '../../../shared/components/icons.jsx';
import ConfirmedLocationInput from '../../../shared/components/maps/ConfirmedLocationInput.jsx';
import { todayIso } from '../../../../business-logic/m6-discovery/discovery/localDate.js';
import { resolveKnownGuideOrigin } from '../../../../business-logic/m6-discovery/guide/GuideOriginResolver.js';

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
  } else if (copy.anyCategory) parts.push(copy.anyCategory);
  const filters = activeFilters(plan, copy).map((filter) => filter.label);
  if (filters.length) parts.push(filters.join(', '));
  return parts;
}

function activeFilters(plan, copy) {
  const filters = [];
  if (plan.indoorPreference === 'indoor') filters.push({ key: 'indoorPreference', label: copy.indoorFilter, clear: { indoorPreference: 'either' } });
  if (plan.indoorPreference === 'outdoor') filters.push({ key: 'indoorPreference', label: copy.outdoorFilter, clear: { indoorPreference: 'either' } });
  if (plan.accessibilityRequired) filters.push({ key: 'accessibilityRequired', label: copy.accessibleFilter, clear: { accessibilityRequired: false } });
  if (plan.children) filters.push({ key: 'children', label: copy.childrenFilter, clear: { children: false } });
  return filters;
}

export default function GuideContextBar({
  plan, copy, language, languagePack, onChange, onSavePreferences, canSave, openOriginRequest = 0, openRequest = 0
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (openOriginRequest > 0 || openRequest > 0) setOpen(true);
  }, [openOriginRequest, openRequest]);

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
    const categories = [...selected];
    patch({ preferredCategories: categories, explicitCategories: categories, categoryMode: categories.length ? 'explicit' : 'any' });
  };
  const chooseAny = () => patch({ preferredCategories: [], explicitCategories: [], categoryMode: 'any' });
  const filters = activeFilters(plan, copy);
  const today = todayIso();
  const minimumEndDate = plan.startDate && plan.startDate > today ? plan.startDate : today;

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
            allowCurrentLocation
            purpose="starting-point"
            resolvePreferredLocation={(query) => {
              const resolved = resolveKnownGuideOrigin(query);
              return resolved ? {
                label: `${resolved.label}, ${resolved.state}, Malaysia`,
                latitude: resolved.lat,
                longitude: resolved.lng
              } : null;
            }}
          />
          <div className="guide-plan__row">
            <label>{copy.from}<input aria-label={copy.from} type="date" min={today} value={plan.startDate || ''} onChange={(event) => patch({ startDate: event.target.value, endDate: event.target.value })} /></label>
            <label>{copy.until}<input aria-label={copy.until} type="date" min={minimumEndDate} value={plan.endDate || ''} onChange={(event) => patch({ endDate: event.target.value })} /></label>
          </div>
          <label>{copy.people}<input aria-label={copy.people} type="number" min="1" max="20" inputMode="numeric" value={plan.partySize || ''} onChange={(event) => patch({ partySize: Number(event.target.value) || null })} /></label>
          <fieldset>
            <legend>{copy.categoryQuestion}</legend>
            <div className="guide-category-chips">
              <button
                type="button"
                className={!plan.preferredCategories.length ? 'active' : ''}
                aria-pressed={!plan.preferredCategories.length}
                onClick={chooseAny}
              >
                {copy.anyCategory}
              </button>
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
          {filters.length > 0 && (
            <fieldset>
              <legend>{copy.practicalFilters}</legend>
              <div className="guide-category-chips">
                {filters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className="active"
                    aria-pressed="true"
                    aria-label={`${copy.clearFilter}: ${filter.label}`}
                    onClick={() => patch(filter.clear)}
                  >
                    {filter.label} ×
                  </button>
                ))}
              </div>
            </fieldset>
          )}
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
