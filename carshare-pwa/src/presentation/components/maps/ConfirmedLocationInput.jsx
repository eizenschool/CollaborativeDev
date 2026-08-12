import { useEffect, useId, useRef, useState } from 'react';
import {
  GooglePlacesService,
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
  allowCurrentLocation = false,
  currentLocationPreview = null
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-suggestions`;
  const messageId = `${inputId}-message`;
  const requestSequence = useRef(0);
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [currentCandidate, setCurrentCandidate] = useState(null);

  const confirmed = GooglePlacesService.isConfirmedLocation(location);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  useEffect(() => {
    const trimmed = query.trim();
    const selectedLabel = (value || '').trim();
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
      setStatus('idle');
      setMessage(trimmed ? `Type at least ${MIN_LOCATION_QUERY_LENGTH} characters to search.` : '');
      return undefined;
    }

    const sequence = ++requestSequence.current;
    setStatus('loading');
    setMessage('Searching locations…');
    const timer = window.setTimeout(async () => {
      try {
        const results = await GooglePlacesService.searchLocations(trimmed);
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
    }, 400);

    return () => window.clearTimeout(timer);
  }, [confirmed, currentCandidate, query, value]);

  function changeText(nextValue) {
    requestSequence.current += 1;
    setQuery(nextValue);
    setCurrentCandidate(null);
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
    }
  }

  async function useCurrentLocation() {
    const sequence = ++requestSequence.current;
    setSuggestions([]);
    setStatus('locating');
    setMessage('Getting your current location…');
    setCurrentCandidate(null);
    try {
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

  const expanded = status === 'ready' && suggestions.length > 0;

  return (
    <div className="confirmed-location-field">
      <label className="route-field" htmlFor={inputId}>
        <span>{label}</span>
        <div className="input-wrap">
          <span className="prefix-icon" aria-hidden="true"><IconMapPin size={14} /></span>
          <input
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={expanded && activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
            aria-describedby={!currentCandidate && (message || (!confirmed && query.trim())) ? messageId : undefined}
            aria-invalid={status === 'error' || Boolean(!confirmed && query.trim() && !currentCandidate)}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(event) => changeText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {confirmed && <span className="location-confirmed-icon" aria-hidden="true"><IconCheck size={14} /></span>}
        </div>
      </label>

      {allowCurrentLocation && (
        <button
          type="button"
          className="current-location-button"
          onClick={useCurrentLocation}
          disabled={status === 'locating'}
        >
          <IconMapPin size={15} /> {status === 'locating' ? 'Locating…' : 'Use current location'}
        </button>
      )}

      {expanded && (
        <div className="location-suggestions-panel">
          <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
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
                <IconMapPin size={15} /> <span>{suggestion.label}</span>
              </li>
            ))}
          </ul>
          <div className="google-attribution">
            <img src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png" alt="Powered by Google" />
          </div>
        </div>
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

      {!currentCandidate && message && (
        <p id={messageId} className={`location-field-message ${status === 'error' ? 'error' : ''}`} aria-live="polite">{message}</p>
      )}
      {!currentCandidate && !message && !confirmed && query.trim() && (
        <p id={messageId} className="location-field-message">Choose a Google suggestion to confirm this location.</p>
      )}
    </div>
  );
}
