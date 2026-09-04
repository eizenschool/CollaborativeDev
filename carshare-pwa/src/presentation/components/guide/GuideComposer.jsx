// ===== PRESENTATION LAYER (GuideComposer) =====
// The message input, voice controls and privacy note. Extracted out of
// TumpangGuidePage.jsx, which held this as a single ~4000-character line.
//
// The language <select> here picks the SPEECH RECOGNITION locale only - it
// does not change what language Tumpang Guide replies in (that is detected
// per message, or set explicitly via a "reply in X" request). The visible
// "Voice input" label exists specifically so the two are not confused with
// each other, which was previously a real source of the "language switching
// felt broken" reports.
import { IconButton } from '../ui/Button.jsx';
import { IconMicrophone, IconSend, IconStop } from '../icons.jsx';

const GUIDE_SPEECH_LANGUAGE_OPTIONS = Object.freeze([
  { value: 'auto', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'ta', label: 'தமிழ்' }
]);

export { GUIDE_SPEECH_LANGUAGE_OPTIONS };

export default function GuideComposer({
  copy, draft, onDraftChange, onSubmit, speechLanguage, spokenLanguageLabel, onChangeSpeechLanguage,
  speech, onStartSpeech, busy, voicePreview
}) {
  return (
    <form className="guide-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="guide-composer__header">
        <label htmlFor="guide-message">{copy.composerLabel}</label>
      </div>
      <div className="guide-composer__input-row">
        <textarea
          id="guide-message"
          rows="2"
          maxLength="1200"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder=""
        />
        <label className="guide-voice-language">
          <span className="guide-voice-language__label">{copy.voiceInputLabel || 'Voice input'}</span>
          <select
            aria-label={spokenLanguageLabel(speechLanguage)}
            title={spokenLanguageLabel(speechLanguage)}
            value={speechLanguage}
            onChange={onChangeSpeechLanguage}
            disabled={speech.listening || speech.processing}
          >
            {GUIDE_SPEECH_LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <IconButton
          label={speech.listening ? copy.stopVoice : copy.startVoice}
          onClick={speech.listening ? speech.stop : onStartSpeech}
          disabled={!speech.supported || speech.processing}
        >
          {speech.listening ? <IconStop size={19} /> : <IconMicrophone size={19} />}
        </IconButton>
        <IconButton label={copy.sendMessage} variant="primary" type="submit" disabled={busy || !draft.trim()}>
          <IconSend size={19} />
        </IconButton>
      </div>
      {voicePreview && <small className="guide-voice-preview" aria-live="polite">{voicePreview}</small>}
      <small>{copy.voiceNote}</small>
      {speech.error && <p className="guide-field-error" role="alert">{speech.error}</p>}
      {speech.cloudFallbackAvailable && !speech.listening && (
        <button type="button" className="guide-text-action" onClick={speech.startCloudFallback} disabled={speech.processing}>
          {speech.fallbackRequired ? (copy.voiceUseCloudFallback || 'Use Groq cloud transcription') : (copy.voiceTryCloudFallback || 'Not happy with this? Try cloud transcription instead')}
        </button>
      )}
    </form>
  );
}
