import { describe, expect, it } from 'vitest';
import { normalizeGeminiSchema } from '../gemini.ts';
import { normalizeStrictJsonSchema } from '../providers.ts';
import { decisionPrompt, GUIDE_AGENT_TOOLS, toolMode } from '../agent.ts';

describe('Tumpang Guide v3 agent tools', () => {
  it('exposes the guarded catalogue, facts, capability, action, weather, route, travel-info and emergency tools in specificity order', () => {
    const names = GUIDE_AGENT_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'search_catalogue', 'get_place_information', 'get_weather_forecast', 'get_route_estimate',
      'get_travel_info', 'get_guide_capabilities', 'prepare_guide_action', 'trigger_emergency',
      'respond_conversationally', 'change_interface_language'
    ]));
    // The two specific deterministic tools must be listed ahead of the
    // generic get_travel_info fallback - naming specificity is the
    // strongest routing lever with function-calling models.
    expect(names.indexOf('get_weather_forecast')).toBeLessThan(names.indexOf('get_travel_info'));
    expect(names.indexOf('get_route_estimate')).toBeLessThan(names.indexOf('get_travel_info'));
  });

  it('keeps ordinary conversation separate from catalogue recommendation', () => {
    expect(toolMode('respond_conversationally')).toBe('small_talk');
    expect(toolMode('search_catalogue')).toBe('recommend');
    expect(toolMode('get_place_information')).toBe('place_info');
    expect(toolMode('get_travel_info')).toBe('travel_info');
  });

  it('routes both new deterministic tools to the shared travel_info mode (regression: the toolMode fall-through otherwise silently returns small_talk, turning every weather question into chit-chat)', () => {
    expect(toolMode('get_weather_forecast')).toBe('travel_info');
    expect(toolMode('get_route_estimate')).toBe('travel_info');
  });

  it('round-trips get_travel_info\'s schema through both Gemini and Groq normalization without loss', () => {
    const tool = GUIDE_AGENT_TOOLS.find((item) => item.name === 'get_travel_info');
    expect(tool).toBeTruthy();
    expect(tool.parameters.required).toEqual(expect.arrayContaining(['topic', 'relatedPlaceName', 'language']));

    const geminiSchema = normalizeGeminiSchema(tool.parameters);
    expect(geminiSchema.properties.topic.type).toBe('STRING');

    const groqSchema = normalizeStrictJsonSchema(tool.parameters);
    expect(groqSchema.additionalProperties).toBe(false);
    expect(groqSchema.required).toEqual(Object.keys(groqSchema.properties));
  });

  it('round-trips get_weather_forecast and get_route_estimate schemas through both providers without loss', () => {
    for (const name of ['get_weather_forecast', 'get_route_estimate']) {
      const tool = GUIDE_AGENT_TOOLS.find((item) => item.name === name);
      expect(tool).toBeTruthy();
      const geminiSchema = normalizeGeminiSchema(tool.parameters);
      expect(geminiSchema.type).toBe('OBJECT');
      const groqSchema = normalizeStrictJsonSchema(tool.parameters);
      expect(groqSchema.additionalProperties).toBe(false);
      expect(groqSchema.required).toEqual(Object.keys(groqSchema.properties));
    }
    const weather = GUIDE_AGENT_TOOLS.find((item) => item.name === 'get_weather_forecast');
    expect(weather.parameters.required).toEqual(expect.arrayContaining(['locationName', 'startDate', 'endDate']));
    const route = GUIDE_AGENT_TOOLS.find((item) => item.name === 'get_route_estimate');
    expect(route.parameters.required).toEqual(expect.arrayContaining(['destinationName', 'originLabel']));
  });

  it('routes the routing prompt away from search_catalogue for weather questions, including the negative case that guards against the new tool stealing recommendation requests', () => {
    const prompt = JSON.parse(decisionPrompt({ message: 'test' }));
    expect(prompt.routingExamples).toMatch(/get_weather_forecast/);
    expect(prompt.routingExamples).toMatch(/get_route_estimate/);
    // Load-bearing negative example: without it, get_weather_forecast starts
    // stealing "somewhere with good weather" style recommendation requests.
    expect(prompt.routingExamples).toMatch(/good weather this weekend.*search_catalogue, NOT get_weather_forecast/i);
    expect(prompt.weatherRule).toMatch(/get_weather_forecast/);
    expect(prompt.routeRule).toMatch(/get_route_estimate/);
  });

  it('warns against conversation-momentum routing a weather question to search_catalogue (regression: this exact bug shipped once already)', () => {
    const prompt = JSON.parse(decisionPrompt({ message: 'test' }));
    expect(prompt.conversationMomentumWarning).toMatch(/get_weather_forecast/);
    expect(prompt.conversationMomentumWarning).not.toMatch(/turn 4 is still get_travel_info/);
  });

  it('carries pendingClarification straight through to the model as structured input, and explains how to use it (regression: a bare one-word reply to a weather/route clarify question - "KLCC", "KL" - used to get reinterpreted as a fresh, unrelated request with no signal that a specific question was still pending)', () => {
    const withPending = JSON.parse(decisionPrompt({
      message: 'KLCC', pendingClarification: { tool: 'get_weather_forecast', field: 'locationName' }
    }));
    expect(withPending.pendingClarification).toEqual({ tool: 'get_weather_forecast', field: 'locationName' });
    expect(withPending.pendingClarificationRule).toMatch(/pendingClarification\.field/);
    expect(withPending.pendingClarificationRule).toMatch(/pendingClarification\.tool/);
    expect(withPending.pendingClarificationRule).toMatch(/destinationName/);

    const withoutPending = JSON.parse(decisionPrompt({ message: 'KLCC' }));
    expect(withoutPending.pendingClarification).toBeUndefined();
  });
});
