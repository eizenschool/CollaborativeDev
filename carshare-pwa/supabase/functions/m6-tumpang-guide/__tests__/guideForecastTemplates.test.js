import { describe, expect, it } from 'vitest';
import {
  conditionLabel, routeAnswerText, routeDestinationClarifyText, routeDestinationUnknownText,
  routeOriginClarifyText, weatherAnswerText, weatherHorizonText, weatherLocationClarifyText,
  weatherServiceDownText
} from '../guideForecastTemplates.ts';

const LANGUAGES = ['en', 'zh-CN', 'ms', 'ta'];
const CONDITION_KEYS = [
  'clear', 'partly_cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'heavy_rain',
  'showers', 'violent_showers', 'thunderstorm', 'thunderstorm_hail', 'freezing', 'snow'
];

const forecast = {
  locationName: 'Kuala Lumpur', latitude: 3.139, longitude: 101.6869,
  days: [
    { date: '2026-09-05', weatherCode: 80, conditionKey: 'showers', severity: 'advisory',
      precipitationProbabilityMax: 70, precipitationSumMm: 12, precipitationHours: 4,
      temperatureMaxC: 32, temperatureMinC: 25, apparentTemperatureMaxC: 36 },
    { date: '2026-09-06', weatherCode: 0, conditionKey: 'clear', severity: 'clear',
      precipitationProbabilityMax: 5, precipitationSumMm: 0, precipitationHours: 0,
      temperatureMaxC: 33, temperatureMinC: 24, apparentTemperatureMaxC: 34 }
  ],
  requestedStartDate: '2026-09-05', requestedEndDate: '2026-09-06',
  effectiveStartDate: '2026-09-05', effectiveEndDate: '2026-09-06',
  clampedToHorizon: false, clampedFromPast: false, datesWereAssumed: false,
  locationWasAssumed: false, unrecognizedLocationName: null,
  checkedAt: '2026-09-03T00:00:00.000Z'
};

const routeGoogleRoutes = {
  kind: 'google_routes', originLabel: 'Kuala Lumpur', destinationName: 'Batu Caves', destinationState: 'Selangor',
  distanceMeters: 13000, durationSeconds: 1800, straightLineKm: 12.3, degradedReason: null, checkedAt: '2026-09-03T00:00:00.000Z'
};

const routeStraightLine = {
  kind: 'straight_line', originLabel: 'Kuala Lumpur', destinationName: 'Batu Caves', destinationState: 'Selangor',
  distanceMeters: null, durationSeconds: null, straightLineKm: 12.3, degradedReason: 'guide_budget_exhausted', checkedAt: '2026-09-03T00:00:00.000Z'
};

const routeUnavailable = {
  kind: 'unavailable', originLabel: '', destinationName: 'Batu Caves', destinationState: 'Selangor',
  distanceMeters: null, durationSeconds: null, straightLineKm: null, degradedReason: 'no_origin', checkedAt: '2026-09-03T00:00:00.000Z'
};

describe('Tumpang Guide deterministic forecast/route copy', () => {
  it('has a distinct, non-empty condition label for every key in all four languages', () => {
    for (const language of LANGUAGES) {
      const labels = new Set();
      for (const key of CONDITION_KEYS) {
        const label = conditionLabel(language, key);
        expect(typeof label).toBe('string');
        expect(label.trim().length).toBeGreaterThan(0);
        labels.add(label);
      }
      expect(labels.size).toBe(CONDITION_KEYS.length);
    }
  });

  it('falls back to English for an unsupported language tag', () => {
    expect(conditionLabel('de', 'rain')).toBe(conditionLabel('en', 'rain'));
    expect(weatherLocationClarifyText('de')).toBe(weatherLocationClarifyText('en'));
  });

  it('produces a non-empty, distinct weatherAnswerText per language containing the real numbers', () => {
    const seen = new Set();
    for (const language of LANGUAGES) {
      const text = weatherAnswerText(language, forecast);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toMatch(/32|33/);
      expect(text).toMatch(/70/);
      seen.add(text);
    }
    expect(seen.size).toBe(LANGUAGES.length);
  });

  it('names the assumed dates when the caller had none to go on', () => {
    const assumed = { ...forecast, datesWereAssumed: true };
    for (const language of LANGUAGES) {
      expect(weatherAnswerText(language, assumed).length)
        .toBeGreaterThan(weatherAnswerText(language, forecast).length);
    }
  });

  it('names the assumed location when no place was given at all (weather is a standalone question, never blocked on a Travel-Brief-style question)', () => {
    const assumed = { ...forecast, locationWasAssumed: true };
    for (const language of LANGUAGES) {
      const text = weatherAnswerText(language, assumed);
      expect(text.length).toBeGreaterThan(weatherAnswerText(language, forecast).length);
      expect(text).toContain('Kuala Lumpur');
    }
  });

  it('gives an honest "I don\'t recognise X" note - distinct from the generic assumed-location note - when a place WAS named but matched nothing', () => {
    const unrecognized = { ...forecast, locationWasAssumed: true, unrecognizedLocationName: 'Timbuktu' };
    for (const language of LANGUAGES) {
      const text = weatherAnswerText(language, unrecognized);
      expect(text).toContain('Timbuktu');
      expect(text).not.toBe(weatherAnswerText(language, { ...forecast, locationWasAssumed: true }));
    }
  });

  it('produces distinct, non-empty horizon and service-down copy per language', () => {
    const horizonSeen = new Set(); const downSeen = new Set();
    for (const language of LANGUAGES) {
      const horizon = weatherHorizonText(language, 'Kuala Lumpur', 'Selangor', '2026-09-25');
      const down = weatherServiceDownText(language, 'Kuala Lumpur', 'Selangor', 9);
      expect(horizon.length).toBeGreaterThan(0);
      expect(down.length).toBeGreaterThan(0);
      horizonSeen.add(horizon); downSeen.add(down);
    }
    expect(horizonSeen.size).toBe(LANGUAGES.length);
    expect(downSeen.size).toBe(LANGUAGES.length);
  });

  it('mentions the monsoon only for a monsoon state in a monsoon month, not otherwise', () => {
    const withMonsoon = weatherHorizonText('en', 'Kota Bharu', 'Kelantan', '2026-12-25');
    const withoutMonsoonState = weatherHorizonText('en', 'Kuala Lumpur', 'Selangor', '2026-12-25');
    const withoutMonsoonMonth = weatherHorizonText('en', 'Kota Bharu', 'Kelantan', '2026-06-25');
    expect(withMonsoon).toMatch(/monsoon/i);
    expect(withoutMonsoonState).not.toMatch(/monsoon/i);
    expect(withoutMonsoonMonth).not.toMatch(/monsoon/i);
  });

  it('states minutes and km for a real Google Routes answer', () => {
    const text = routeAnswerText('en', routeGoogleRoutes);
    expect(text).toContain('30 minutes');
    expect(text).toContain('13 km');
  });

  it('never fabricates a duration for a straight-line degraded answer', () => {
    for (const language of LANGUAGES) {
      const text = routeAnswerText(language, routeStraightLine);
      expect(text).toMatch(/12\.3/);
      expect(text).not.toMatch(/minute|分钟|minit|நிமிட/);
    }
  });

  it('gives an honest, actionable answer when there is no straight-line number to fall back on either', () => {
    for (const language of LANGUAGES) {
      const text = routeAnswerText(language, routeUnavailable);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('12.3');
    }
  });

  it('every clarifying question states what form of answer it accepts, so the traveller is not guessing', () => {
    // The live session showed a traveller answering "馬六甲" to "which place
    // do you want the travel time to?" and being told it was not in the
    // catalogue - the question never said a town name was acceptable.
    expect(routeDestinationClarifyText('en')).toMatch(/town|city/i);
    expect(routeDestinationClarifyText('zh-CN')).toContain('城市');
    expect(routeOriginClarifyText('en')).toMatch(/town|city|location/i);
    expect(weatherLocationClarifyText('en')).toMatch(/town|city/i);
  });

  it('explains an unplaceable destination as exactly that, never as a catalogue rule, and says what to try instead', () => {
    for (const language of LANGUAGES) {
      const text = routeDestinationUnknownText(language, 'Timbuktu');
      expect(text).toContain('Timbuktu');
      expect(text).not.toMatch(/catalogue|katalog|资料库|目录/i);
      expect(text.length).toBeGreaterThan(20);
    }
  });

  it('has non-empty, distinct clarify prompts per language for both route origin and destination', () => {
    const originSeen = new Set(); const destinationSeen = new Set();
    for (const language of LANGUAGES) {
      originSeen.add(routeOriginClarifyText(language));
      destinationSeen.add(routeDestinationClarifyText(language));
    }
    expect(originSeen.size).toBe(LANGUAGES.length);
    expect(destinationSeen.size).toBe(LANGUAGES.length);
  });
});
