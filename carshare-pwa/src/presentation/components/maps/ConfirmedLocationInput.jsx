import { useEffect, useId, useRef, useState } from 'react';
import {
  GooglePlacesService,
  LOCATION_SEARCH_DEBOUNCE_MS,
  MAX_AUTOCOMPLETE_BIAS_ACCURACY_METRES,
  MIN_LOCATION_QUERY_LENGTH
} from '../../../business-logic/GooglePlacesService.js';
import { IconCheck, IconMapPin } from '../icons.jsx';

export default function ConfirmedLocationInput({
  id,
  label,
  placeholder,
  value,
  location,
  onChange,
  disabled = false,
  allowCurrentLocation = false,
  currentLocationPreview = null,
  loadNearbySuggestions = null
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-suggestions`;
  const messageId = `${inputId}-message`;
  const requestSequence = useRef(0);
  const inputRef = useRef(null);
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [currentCandidate, setCurrentCandidate] = useState(null);
  const [currentLocationSession, setCurrentLocationSession] = useState(null);

  const confirmed = GooglePlacesService.isConfirmedLocation(location);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  useEffect(() => {
    const trimmed = query.trim();
    const selectedLabel = (value || '').trim();
    if (disabled) {
      requestSequence.current += 1;
      setSuggestions([]);
      setStatus('idle');
      setMessage('');
      setCurrentLocationSession(null);
      return undefined;
    }
    if (currentLocationSession) return undefined;
    if (confirmed && trimmed === selectedLabel) {
      requestSequence.current += 1;
      setSuggestions([]);
      setStatus('idle');
      setMessage('');
      return undefined;
    }
    if (currentCandidate && trimmed === currentCandidate.label) return undefined;
    if (trimmed.length < MIN_LOCATION_QUERY_LENGTH) {
      requestSequence.current += 1;
      setSuggestions([]);
      setActiveIndex(-1);
      setStatus('idle');
      setMessage(trimmed ? `Type at least ${MIN_LOCATION_QUERY_LENGTH} characters to search.` : '');
      return undefined;
    }

    const sequence = ++requestSequence.current;
    setStatus('loading');
    setMessage('Searching locations…');
    const timer = window.setTimeout(async () => {
      try {
        const results = await GooglePlacesService.searchLocations(trimmed, { origin: currentLocationPreview });
        if (sequence !== requestSequence.current) return;
        setSuggestions(results);
        setActiveIndex(results.length ? 0 : -1);
        setStatus(results.length ? 'ready' : 'empty');
        setMessage(results.length ? '' : 'No matching locations found in Malaysia.');
      } catch (error) {
        if (sequence !== requestSequence.current) return;
        setSuggestions([]);
        setActiveIndex(-1);
        setStatus('error');
        setMessage(error.message);
      }
    }, LOCATION_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [confirmed, currentCandidate, currentLocationPreview, currentLocationSession, disabled, query, value]);

  function changeText(nextValue) {
    requestSequence.current += 1;
    setQuery(nextValue);
    setCurrentCandidate(null);
    setCurrentLocationSession(null);
    setActiveIndex(-1);
    onChange(nextValue, null);
  }

  function selectSuggestion(suggestion) {
    requestSequence.current += 1;
    setQuery(suggestion.label);
    setSuggestions([]);
    setStatus('idle');
    setMessage('');
    setActiveIndex(-1);
    setCurrentCandidate(null);
    setCurrentLocationSession(null);
    onChange(suggestion.label, { source: 'place', placeId: suggestion.placeId });
  }

  function handleKeyDown(event) {
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setSuggestions([]);
      setActiveIndex(-1);
      setCurrentLocationSession(null);
      setStatus('idle');
      setMessage('');
    }
  }

  async function useCurrentLocation() {
    const sequence = ++requestSequence.current;
    setSuggestions([]);
    setStatus('locating');
    setMessage(loadNearbySuggestions
      ? 'Getting your current location and nearby pickup alternatives…'
      : 'Getting your current location…');
    setCurrentCandidate(null);
    setCurrentLocationSession(loadNearbySuggestions ? { state: 'loading' } : null);
    try {
      if (loadNearbySuggestions) {
        const position = await GooglePlacesService.getCurrentLocationPreview();
        if (sequence !== requestSequence.current) return;
        if (position.accuracy > MAX_AUTOCOMPLETE_BIAS_ACCURACY_METRES) {
          setCurrentLocationSession({ state: 'error' });
          setStatus('error');
          setMessage(`Your location is only accurate to about ${Math.round(position.accuracy)} m. Move to an open area and retry, or search for a pickup point.`);
          return;
        }

        const [currentResult, nearbyResult] = await Promise.allSettled([
          GooglePlacesService.resolveCurrentLocation({ position }),
          loadNearbySuggestions(position)
        ]);
        if (sequence !== requestSequence.current) return;
        const current = currentResult.status === 'fulfilled' ? currentResult.value : null;
        const nearby = nearbyResult.status === 'fulfilled' ? nearbyResult.value : [];
        if (current) {
          setQuery(current.label);
          onChange(current.label, current.location);
        }
        setSuggestions(nearby);
        setActiveIndex(nearby.length ? 0 : -1);
        setCurrentLocationSession({
          state: 'ready',
          accuracy: Math.round(position.accuracy),
          currentSelected: Boolean(current)
        });

        if (nearby.length) {
          setStatus('nearby');
          setMessage(current
            ? `Current location selected with ±${Math.round(position.accuracy)} m accuracy.`
            : 'Your GPS point was not accurate enough to select directly. Choose a nearby pickup alternative.');
          inputRef.current?.focus();
        } else if (current) {
          setStatus('success');
          setMessage(`Current location selected with ±${current.accuracy} m accuracy. Nearby pickup alternatives are unavailable; you can keep this pickup or search manually.`);
        } else {
          setCurrentLocationSession({ state: 'error' });
          setStatus('error');
          const currentMessage = currentResult.reason?.message || 'Your current address could not be resolved.';
          const nearbyMessage = nearbyResult.reason?.message || 'No nearby pickup alternatives were found.';
          setMessage(`${currentMessage} ${nearbyMessage} Search for a pickup point instead.`);
        }
        return;
      }
      const candidate = await GooglePlacesService.resolveCurrentLocation({
        position: currentLocationPreview || undefined
      });
      if (sequence !== requestSequence.current) return;
      setCurrentCandidate(candidate);
      setQuery(candidate.label);
      onChange(candidate.label, null);
      setStatus('confirming');
      setMessage('Check this pickup before sharing it with passengers.');
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setCurrentLocationSession(loadNearbySuggestions ? { state: 'error' } : null);
      setStatus('error');
      setMessage(error.message);
    }
  }

  function confirmCurrentLocation() {
    onChange(currentCandidate.label, currentCandidate.location);
    setCurrentCandidate(null);
    setStatus('idle');
    setMessage('');
  }

  function rejectCurrentLocation() {
    setCurrentCandidate(null);
    setQuery('');
    setStatus('idle');
    setMessage('');
    onChange('', null);
  }

  const expanded = (status === 'ready' || status === 'nearby') && suggestions.length > 0;

  return (
    <div className="confirmed-location-field">
      <div className="route-field">
        <label htmlFor={inputId}>{label}</label>
        <div className="input-wrap">
          <span className="prefix-icon" aria-hidden="true"><IconMapPin size={14} /></span>
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={expanded && activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
            aria-describedby={!currentCandidate && !expanded && (message || (!confirmed && query.trim())) ? messageId : undefined}
            aria-invalid={status === 'error' || Boolean(!confirmed && query.trim() && !currentCandidate)}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            disabled={disabled}
            onChange={(event) => changeText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {confirmed && <span className="location-confirmed-icon" aria-hidden="true"><IconCheck size={14} /></span>}

          {expanded && (
            <div className="location-suggestions-panel">
              {status === 'nearby' && currentLocationSession?.currentSelected && (
                <p className="location-current-selection-status" role="status">
                  <IconCheck size={14} aria-hidden="true" /> Current location selected · ±{currentLocationSession.accuracy} m
                </p>
              )}
              {status === 'nearby' && !currentLocationSession?.currentSelected && (
                <p className="location-current-selection-note" role="status">
                  Your GPS point was not accurate enough to select directly. Choose a nearby pickup below.
                </p>
              )}
              <p className="location-suggestions-heading">{status === 'nearby' ? 'Nearby pickup alternatives' : 'Search suggestions'}</p>
              <ul id={listId} role="listbox" aria-label={`${label} ${status === 'nearby' ? 'nearby pickup alternatives' : 'suggestions'}`}>
                {suggestions.map((suggestion, index) => (
                  <li
                    id={`${inputId}-option-${index}`}
                    key={suggestion.placeId}
                    role="option"
                    aria-selected={activeIndex === index}
                    className={activeIndex === index ? 'active' : ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(suggestion)}
                  >
                    <IconMapPin size={15} /> <span>{suggestion.label}{suggestion.distanceMeters != null && <small className="location-distance">{suggestion.distanceMeters >= 1000 ? `${(suggestion.distanceMeters / 1000).toFixed(1)} km away` : `${Math.round(suggestion.distanceMeters)} m away`}</small>}</span>
                  </li>
                ))}
              </ul>
              <div className="google-attribution">
                <img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" />
              </div>
            </div>
          )}
        </div>
      </div>

      {allowCurrentLocation && !disabled && (
        <button
          type="button"
          className="current-location-button"
          onClick={useCurrentLocation}
          disabled={status === 'locating'}
        >
          <IconMapPin size={15} /> {status === 'locating' ? 'Locating…' : 'Use current location'}
        </button>
      )}

      {currentCandidate && (
        <div className="current-location-confirmation">
          <strong>{currentCandidate.label}</strong>
          <span>GPS accuracy: ±{currentCandidate.accuracy} m</span>
          <div>
            <button type="button" className="btn-secondary" onClick={rejectCurrentLocation}>Choose another place</button>
            <button type="button" className="btn-primary" onClick={confirmCurrentLocation}>Use this pickup</button>
          </div>
        </div>
      )}

      {!currentCandidate && !expanded && message && (
        <p id={messageId} className={`location-field-message ${status === 'error' ? 'error' : ''}`} aria-live="polite">{message}</p>
      )}
      {!currentCandidate && !expanded && !message && !confirmed && query.trim() && (
        <p id={messageId} className="location-field-message">Choose a Google suggestion to confirm this location.</p>
      )}
    </div>
  );
}
