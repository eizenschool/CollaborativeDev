import { useNotifications } from '../../../context/NotificationContext.jsx';

function VolumeSlider({ id, label, description, value, disabled, onChange, onPreview }) {
  const percentage = Math.round(value * 100);

  return (
    <div className="notification-volume-row">
      <div className="notification-volume-copy">
        <label htmlFor={id}>{label}</label>
        <span>{description}</span>
      </div>
      <div className="notification-volume-input">
        <input
          id={id}
          type="range"
          min="0"
          max="100"
          step="5"
          value={percentage}
          disabled={disabled}
          aria-valuetext={percentage === 0 ? 'Muted' : `${percentage} percent`}
          onChange={(event) => onChange(Number(event.target.value) / 100)}
        />
        <output htmlFor={id}>{percentage}%</output>
        <button
          type="button"
          className="btn-link notification-volume-preview"
          disabled={disabled || percentage === 0}
          onClick={() => { void onPreview(); }}
        >
          Test
        </button>
      </div>
    </div>
  );
}

export default function SoundPreferences({ compact = false, card = false }) {
  const {
    alertSoundsEnabled,
    notificationVolume,
    callRingtoneVolume,
    soundBlocked,
    setAlertSounds,
    setNotificationVolume,
    setCallRingtoneVolume,
    previewNotificationSound,
    previewCallRingtone,
    unlockAlertSounds,
  } = useNotifications();

  if (compact) {
    return (
      <div className="notification-sound-control">
        <button
          type="button"
          className="btn-link"
          aria-pressed={alertSoundsEnabled}
          onClick={() => { void setAlertSounds(!alertSoundsEnabled); }}
        >
          {alertSoundsEnabled ? 'Turn alert sounds off' : 'Turn alert sounds on'}
        </button>
        {alertSoundsEnabled && soundBlocked && (
          <button type="button" className="notification-enable-push" onClick={() => { void unlockAlertSounds(); }}>
            Enable sound in this browser
          </button>
        )}
      </div>
    );
  }

  return (
    <section className={'notification-sound-preferences' + (card ? ' card' : '')} aria-labelledby={card ? 'sound-preferences-title' : undefined}>
      {card && (
        <div className="notification-sound-heading">
          <p id="sound-preferences-title" className="card-title">Sound preferences</p>
          <p className="card-subtitle">Set notification and incoming-call volume for this account on this device.</p>
        </div>
      )}
      <div className="notification-sound-master">
        <span>{alertSoundsEnabled ? 'Alert sounds are on' : 'Alert sounds are off'}</span>
        <button
          type="button"
          className="btn-link"
          aria-pressed={alertSoundsEnabled}
          onClick={() => { void setAlertSounds(!alertSoundsEnabled); }}
        >
          {alertSoundsEnabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <VolumeSlider
        id={card ? 'profile-notification-volume' : 'notification-volume'}
        label="Notification volume"
        description="New messages, ride updates, and reminders"
        value={notificationVolume}
        disabled={!alertSoundsEnabled}
        onChange={setNotificationVolume}
        onPreview={previewNotificationSound}
      />
      <VolumeSlider
        id={card ? 'profile-call-ringtone-volume' : 'call-ringtone-volume'}
        label="Incoming call ringtone"
        description="Private and group call invitations"
        value={callRingtoneVolume}
        disabled={!alertSoundsEnabled}
        onChange={setCallRingtoneVolume}
        onPreview={previewCallRingtone}
      />
      {alertSoundsEnabled && soundBlocked && (
        <button type="button" className="notification-enable-push notification-sound-unlock" onClick={() => { void unlockAlertSounds(); }}>
          Enable sound in this browser
        </button>
      )}
      <p className="notification-sound-note">SOS rings at its safety volume while this PWA is active. In the background, your phone controls notification sound and vibration.</p>
    </section>
  );
}
