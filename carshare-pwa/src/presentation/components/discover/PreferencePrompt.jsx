// ===== PRESENTATION LAYER (PreferencePrompt) =====
// UC6.4 - shown only to a user with no completed trips and no stated preferences.
//
// Dismissal is a first-class outcome, not a failure: recommendations stay
// available and only the personalisation signal goes neutral, so nobody is
// blocked behind an onboarding step they did not want.
import { useState } from 'react';
import { CATEGORY } from '../../../business-logic/discovery/constants.js';

const CHOICES = [
  { value: CATEGORY.CULINARY, emoji: '🍜', label: 'Food' },
  { value: CATEGORY.HERITAGE, emoji: '🏛️', label: 'Heritage' },
  { value: CATEGORY.NATURE, emoji: '🌿', label: 'Nature' },
  { value: CATEGORY.EVENT, emoji: '🎪', label: 'Events' }
];

export default function PreferencePrompt({ onSave, onDismiss }) {
  const [selected, setSelected] = useState([]);

  const toggle = (value) => setSelected((current) =>
    current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  );

  return (
    <section className="dsc-prompt">
      <h2>Tell us what you enjoy</h2>
      <p>You have no trips yet, so pick what interests you and we will start from there.</p>

      <div className="dsc-prompt-choices">
        {CHOICES.map(({ value, emoji, label }) => (
          <button
            key={value}
            type="button"
            className={'dsc-prompt-choice' + (selected.includes(value) ? ' selected' : '')}
            onClick={() => toggle(value)}
            aria-pressed={selected.includes(value)}
          >
            <span aria-hidden="true">{emoji}</span> {label}
          </button>
        ))}
      </div>

      <div className="dsc-actions">
        <button
          className="dsc-btn dsc-btn-primary"
          onClick={() => onSave(selected)}
          disabled={selected.length === 0}
          type="button"
        >
          Save preferences
        </button>
        <button className="dsc-btn dsc-btn-ghost" onClick={onDismiss} type="button">
          Skip for now
        </button>
      </div>
    </section>
  );
}
