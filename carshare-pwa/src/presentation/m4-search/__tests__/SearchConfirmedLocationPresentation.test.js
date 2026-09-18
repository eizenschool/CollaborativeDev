import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const form = readFileSync(resolve(
  import.meta.dirname,
  '../components/SearchForm.jsx'
), 'utf8');
const locationInput = readFileSync(resolve(
  import.meta.dirname,
  '../../shared/components/maps/ConfirmedLocationInput.jsx'
), 'utf8');
const moduleSource = readFileSync(resolve(
  import.meta.dirname,
  '../components/SearchModule.jsx'
), 'utf8');

describe('Module 4 confirmed location presentation contract', () => {
  it('reuses the shared Google combobox for both Search route fields', () => {
    expect(form).toContain("import ConfirmedLocationInput from '../../shared/components/maps/ConfirmedLocationInput.jsx'");
    expect(form.match(/<ConfirmedLocationInput/g)).toHaveLength(2);
    expect(form.match(/searchOnFocusOnly/g)).toHaveLength(2);
    expect(form).toContain('pickupPlaceId');
    expect(form).toContain('destinationSearchPlaceId');
  });

  it('keeps prefilled fields closed until focused while retaining the one-second service debounce', () => {
    expect(locationInput).toContain('searchOnFocusOnly = false');
    expect(locationInput).toContain('searchOnFocusOnly && !focused');
    expect(locationInput).toContain('LOCATION_SEARCH_DEBOUNCE_MS');
    expect(locationInput).toContain('role="combobox"');
    expect(locationInput).toContain('role="listbox"');
  });

  it('shows all three radius choices independently of the recommendation picker', () => {
    expect(moduleSource).toContain('SEARCH_PROXIMITY_RADII.map');
    expect(moduleSource).toContain('disabled={!criteria.destination');
    expect(moduleSource).toContain('Match exact destination');
    expect(moduleSource).toMatch(/function selectRecommendation[\s\S]*?destinationPlaceId: place\.sourcePlaceId,[\s\S]*?proximityKm: 0/);
  });
});
