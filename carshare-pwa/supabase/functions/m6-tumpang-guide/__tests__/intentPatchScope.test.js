import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A source-text assertion, not a behavioral unit test: extractProviderIntent
// (index.ts) reads Deno.env at module scope, so it cannot be imported
// directly by Vitest. This pins the fix for a real bug found before ship -
// every non-search_catalogue tool (get_weather_forecast, get_route_estimate,
// get_place_information, etc.) used to have its args.startDate/endDate/
// originLabel/partySize/preferredCategories/recommendationMode copied
// unconditionally into the Travel Brief patch. A bare "will it rain
// tomorrow?" routed to get_weather_forecast would silently rewrite the
// traveller's trip dates the moment that tool declared a startDate
// parameter, purely as a side effect of asking about the weather.
const source = readFileSync(
  resolve(import.meta.dirname, '../index.ts'), 'utf8'
);

describe('Tumpang Guide intentPatch scoping (regression: Travel Brief fields must stay search_catalogue-only)', () => {
  it('guards every Travel Brief field with the search_catalogue check instead of copying args unconditionally', () => {
    const extraction = source.slice(source.indexOf('const extraction = {'), source.indexOf('const model = provider'));
    expect(extraction).toContain('isCatalogueSearch');
    for (const field of ['originLabel', 'partySize', 'startDate', 'endDate', 'preferredCategories', 'recommendationMode']) {
      const fieldLine = extraction.slice(extraction.indexOf(`${field}:`));
      expect(fieldLine.slice(0, fieldLine.indexOf('\n') + 1)).toMatch(/isCatalogueSearch/);
    }
  });

  it('does not contain the old unguarded pattern', () => {
    expect(source).not.toContain('startDate: args.startDate || ""');
    expect(source).not.toContain('originLabel: args.originLabel || ""');
  });

  it('derives isCatalogueSearch from the actual tool the model chose, not from the resulting mode', () => {
    const line = source.slice(source.indexOf('const isCatalogueSearch ='), source.indexOf('const isCatalogueSearch =') + 120);
    expect(line).toContain('choice.toolName');
    expect(line).toContain('search_catalogue');
  });
});

describe('Tumpang Guide pendingClarification wiring (regression: a bare one-word reply to a weather/route clarify question got reinterpreted as an unrelated fresh request, since nothing told the routing call a specific question was still pending)', () => {
  it('validates the client-echoed shape narrowly before it ever reaches the routing prompt', () => {
    expect(source).toContain('function safePendingClarification');
    expect(source).toContain('const pendingClarification = safePendingClarification(body.pendingClarification)');
  });

  it('threads pendingClarification into the same single chooseGuideTool call, never as a second routing decision', () => {
    const extract = source.slice(source.indexOf('async function extractProviderIntent'), source.indexOf('async function extractProviderIntent') + 2000);
    expect(extract).toContain('pendingClarification');
    expect(extract).toMatch(/chooseGuideTool\(provider, \{[\s\S]*pendingClarification/);
  });

  it('sets pendingClarification on every weather/route clarify response and clears it by default everywhere else', () => {
    expect(source).toContain("pendingClarification: { tool: \"get_weather_forecast\", field: \"locationName\" }");
    expect(source).toContain("pendingClarification: { tool: \"get_route_estimate\", field: \"destinationName\" }");
    expect(source).toMatch(/pendingClarification:\s*\{\s*tool:\s*"get_route_estimate",\s*field:\s*"originLabel",\s*destinationName:\s*destination\.name\s*\}/);
    expect(source).toContain('response.pendingClarification = response.pendingClarification || null');
  });

  it('never silently pretends a default location was actually the place the traveller named (regression: a fallback used to relabel a named-but-unmatched place as the traveller\'s origin without saying so)', () => {
    const weatherBranch = source.slice(source.indexOf('if (intent.toolName === "get_weather_forecast")'), source.indexOf('if (intent.toolName === "get_route_estimate")'));
    // A named place that matched neither the catalogue nor the free city
    // table is tracked separately (unrecognizedLocationName) from a place
    // that was simply never named at all (locationWasAssumed alone) - the
    // answer text is honest about which one happened instead of collapsing
    // both into the same silent substitution.
    expect(weatherBranch).toContain('const unrecognizedLocationName = !resolvedLocation && wantedLocation ? wantedLocation : null');
    expect(weatherBranch).toContain('locationWasAssumed, unrecognizedLocationName');
  });
});

describe('Tumpang Guide clarify loop (regression: production asked "which place should I check the forecast for?", was answered "melaka", and asked the identical question again - twice - because the reply re-entered the same resolution code that had just failed on it)', () => {
  const weatherBranch = source.slice(
    source.indexOf('if (intent.toolName === "get_weather_forecast")'),
    source.indexOf('if (intent.toolName === "get_route_estimate")')
  );

  it('resolves a named major city BEFORE catalogue venue matching, not after it', () => {
    // matchCataloguePlaces (placeInfo.ts) scores any venue whose name merely
    // *contains* the query at .92, so a city name ties with every catalogue
    // venue inside that city and reads as venue ambiguity. Resolving the
    // city first is what stops an unambiguous question becoming a question
    // back. Ordering is the entire fix, so it is what the test pins.
    const cityLookup = weatherBranch.indexOf('resolveMalaysianCity(wantedLocation)');
    const catalogueLookup = weatherBranch.indexOf('matchCataloguePlaces(');
    expect(cityLookup).toBeGreaterThan(-1);
    expect(catalogueLookup).toBeGreaterThan(-1);
    expect(cityLookup).toBeLessThan(catalogueLookup);
  });

  it('treats a venue tie inside a city the traveller named as a city-level question rather than asking', () => {
    expect(weatherBranch).toContain('matchMalaysianCityInText(wantedLocation)');
  });

  it('asks a weather clarifying question at most once - a turn that is already answering one can never ask it again', () => {
    expect(weatherBranch).toContain("const alreadyAskedForLocation = pendingClarification?.tool === \"get_weather_forecast\"");
    expect(weatherBranch).toContain('if (clarifyChoices.length && !alreadyAskedForLocation)');
  });

  it('applies the same one-question rule to the route destination, ending in a real answer instead of a third identical question', () => {
    const routeBranch = source.slice(source.indexOf('if (intent.toolName === "get_route_estimate")'));
    expect(routeBranch).toContain("const alreadyAskedForRoute = pendingClarification?.tool === \"get_route_estimate\"");
    expect(routeBranch).toContain('if (!destination && alreadyAskedForRoute)');
    expect(routeBranch).toContain('route_destination_not_in_catalogue');
  });

  it('accepts a town or city as a route destination, resolved before catalogue matching just like the weather branch', () => {
    // "How long does it take to get to Melaka" needs coordinates, not a
    // catalogue entry. Live session: the identical name answered a weather
    // question correctly and was refused as a route destination.
    const routeBranch = source.slice(source.indexOf('if (intent.toolName === "get_route_estimate")'));
    const cityLookup = routeBranch.indexOf('resolveMalaysianCity(wantedDestination)');
    const catalogueLookup = routeBranch.indexOf('matchCataloguePlaces(');
    expect(cityLookup).toBeGreaterThan(-1);
    expect(cityLookup).toBeLessThan(catalogueLookup);
    expect(routeBranch).toContain('matchMalaysianCityInText(wantedDestination)');
  });

  it('blames the map, not the catalogue, when a destination resolves to nothing at all', () => {
    const routeBranch = source.slice(source.indexOf('if (intent.toolName === "get_route_estimate")'));
    expect(routeBranch).toContain('routeDestinationUnknownText(responseLanguage, wantedDestination)');
  });

  it('resolves a typed origin reply into real coordinates instead of only using it for display text (regression: the clarify text promised "or just tell me the town" but a typed town name was extracted into intent.routeOriginLabel and then only ever used to build the display string - never resolved into coordinates, so it silently failed and re-asked the same question)', () => {
    const routeBranch = source.slice(source.indexOf('if (intent.toolName === "get_route_estimate")'));
    const originSection = routeBranch.slice(routeBranch.indexOf('let originCoords ='), routeBranch.indexOf('if (!originCoords && !originPlaceId) {'));
    expect(originSection).toContain('resolveMalaysianCity(intent.routeOriginLabel)');
    expect(originSection).toContain('matchMalaysianCityInText(intent.routeOriginLabel)');
    expect(originSection).toContain('geocodeMalaysianPlace(intent.routeOriginLabel');
    // A plan/geolocation origin is more precise than a bare typed name, so it
    // must still be checked first - the typed-name resolution only runs when
    // both are absent.
    expect(originSection).toMatch(/if \(!originCoords && !originPlaceId && intent\.routeOriginLabel\)/);
  });
});

describe('Tumpang Guide weather/route clarify text is never AI-rewritten (regression: production logs caught renderProviderTextTurn silently changing what question was being asked - "which place should I check the forecast for?" came back rephrased as "where are you starting from?", a different question, since the render step only validates mode/language/length and never that the meaning survived)', () => {
  // Each clarify block is its own const base {...}; return await finalize(...)
  // statement with no renderProviderTextTurn call in between - check the
  // gap between the template call and the very next finalize() call is
  // clean, rather than trying to hand-compute section boundaries.
  function textBetween(marker, endMarker) {
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf(endMarker, start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it('sends the weather-location clarify straight to finalize with the deterministic template, no renderProviderTextTurn call', () => {
    const scoped = textBetween('assistantMessage: weatherLocationClarifyText(responseLanguage)', 'return await finalize');
    expect(scoped).not.toContain('renderProviderTextTurn');
    expect(scoped).toContain('source: "rules"');
  });

  it('sends the route-destination clarify straight to finalize with the deterministic template, no renderProviderTextTurn call', () => {
    const scoped = textBetween('assistantMessage: routeDestinationClarifyText(responseLanguage)', 'return await finalize');
    expect(scoped).not.toContain('renderProviderTextTurn');
    expect(scoped).toContain('source: "rules"');
  });

  it('sends the route-origin clarify straight to finalize with the deterministic template, no renderProviderTextTurn call', () => {
    const scoped = textBetween('assistantMessage: routeOriginClarifyText(responseLanguage)', 'return await finalize');
    expect(scoped).not.toContain('renderProviderTextTurn');
    expect(scoped).toContain('source: "rules"');
  });

  it('still runs the final weather/route answer through renderProviderTextTurn - only the precise clarifying questions skip it', () => {
    const weatherBranch = source.slice(source.indexOf('if (intent.toolName === "get_weather_forecast")'), source.indexOf('if (intent.toolName === "get_route_estimate")'));
    const answerSection = weatherBranch.slice(weatherBranch.indexOf('assistantMessage: deterministicText'));
    expect(answerSection).toContain('renderProviderTextTurn');
  });
});
