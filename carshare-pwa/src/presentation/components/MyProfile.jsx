// ===== PRESENTATION LAYER (MyProfile) =====
// Consolidates Profile Settings, My Vehicles, Reputation, Host Dashboard, and
// Account Settings into one "My Profile" page: a sidebar (compact reputation
// hero card + section rail) plus a content panel, matching the approved UX
// reference. All five screens are Module 1 data about the same user, so this
// is one read/write surface instead of five.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { ProfileService } from '../../business-logic/ProfileService.js';
import { VehicleService } from '../../business-logic/VehicleService.js';
import { HostImpactEngine } from '../../business-logic/HostImpactEngine.js';
import { ReputationService } from '../../business-logic/ReputationService.js';
import { IdentityVerificationService } from '../../business-logic/IdentityVerificationService.js';
import IdentityVerificationCard from './profile/IdentityVerificationCard.jsx';
import { describeReputationEvent, REPUTATION_POLICY } from '../../business-logic/ReputationPolicy.js';
import { sharePublicProfile } from '../../business-logic/ProfileShareService.js';
import TrustedFamilyCard from './profile/TrustedFamilyCard.jsx';
import {
  SPOKEN_LANGUAGE_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  vehicleTypeLabel
} from '../../business-logic/CompatibilityOptions.js';
import {
  IconUser, IconMail, IconPhone, IconLock, IconEye, IconEyeOff, IconSave, IconHeart,
  IconCar, IconPlus, IconEdit, IconTrash, IconPause, IconPlay, IconCheckCircle,
  IconMedal, IconCheck, IconBolt, IconLeaf, IconStar,
  IconLayers, IconShield, IconAlertTriangle, IconSettings, IconCamera, IconChart, IconUsers, IconLogOut
} from './icons.jsx';
// Module 5 owns its own entry card, so this file only has to place it.
import ImpactEntryCard from './trip/ImpactEntryCard.jsx';
import AdaptiveDialog from './ui/AdaptiveDialog.jsx';
import { Button } from './ui/Button.jsx';
import SoundPreferences from './notifications/SoundPreferences.jsx';

const RAIL_ITEMS = [
  { id: 'overview', label: 'Overview', Icon: IconLayers },
  { id: 'info', label: 'Info & Security', Icon: IconShield },
  { id: 'vehicles', label: 'My Vehicles', Icon: IconCar },
  { id: 'reputation', label: 'Reputation & Impact', Icon: IconChart },
  { id: 'settings', label: 'Account Settings', Icon: IconSettings }
];

function initialsOf(name) {
  return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function MyProfile() {
  const { user, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState('overview');
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [reputation, setReputation] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    if (!user) return;
    refreshVehicles();
    refreshImpact();
  }, [user]);

  async function refreshVehicles() {
    setVehiclesLoading(true);
    try {
      setVehicles(await VehicleService.listVehicles(user.id));
    } finally {
      setVehiclesLoading(false);
    }
  }

  async function refreshImpact() {
    const [impactSummary, reputationSummary] = await Promise.all([
      HostImpactEngine.getImpactSummary(user.id),
      ReputationService.getSummary(user.id)
    ]);
    setSummary(impactSummary);
    setReputation(reputationSummary);
  }

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      await signOut();
      navigate('/home', { replace: true });
    } catch (error) {
      setSignOutError(error.message || 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  if (!user) return null;

  const activeVehicleCount = vehicles.filter((v) => v.active).length;
  const initials = initialsOf(user.fullName);

  return (
    <div className="profile-page">
      <h1 className="sr-only">My profile</h1>
      <aside className="profile-sidebar">
        <div className="hero-card">
          <div className="hero-card-avatar-wrap">
            <div
              className="hero-card-avatar"
              style={user.profilePhotoUrl ? { backgroundImage: `url(${user.profilePhotoUrl})` } : undefined}
            >
              {!user.profilePhotoUrl && initials}
            </div>
            <button className="hero-card-camera" onClick={() => setPanel('info')} title="Change photo" aria-label="Change profile photo" type="button">
              <IconCamera size={13} aria-hidden="true" />
            </button>
          </div>
          <div className="hero-card-name">{user.fullName}</div>
          {reputation && (
            <div className="hero-card-meta-row">
              <span className="hero-card-rating"><IconStar size={13} /> {reputation.score}/100</span>
              <span className="hero-card-tier"><IconMedal size={11} /> {reputation.standing.label}</span>
            </div>
          )}
          {reputation && (
            <div className="rep-bar">
              <div className="rep-bar-track"><div className="rep-bar-fill" style={{ width: reputation.score + '%' }} /></div>
              <div className="rep-bar-labels"><span>Reputation score</span><span>{reputation.score}/100</span></div>
            </div>
          )}
        </div>

        <nav className="rail-card" aria-label="Profile sections">
          {RAIL_ITEMS.map(({ id, label, Icon }) => (
            <button key={id} className={'rail-item' + (panel === id ? ' active' : '')} onClick={() => setPanel(id)} aria-current={panel === id ? 'page' : undefined}>
              <span className="rail-icon"><Icon size={14} aria-hidden="true" /></span> {label}
            </button>
          ))}
        </nav>
        <p className="rail-note">Reputation is calculated from verified Module 2 ride outcomes. Host Impact is calculated separately by Module 5.</p>
      </aside>

      <main className="panels">
        {panel === 'overview' && (
          <OverviewPanel
            user={user}
            summary={summary}
            reputation={reputation}
            vehicles={vehicles}
            activeVehicleCount={activeVehicleCount}
            onOpenImpact={() => navigate('/trip')}
          />
        )}
        {panel === 'info' && <InfoSecurityPanel user={user} onSaved={setUser} />}
        {panel === 'vehicles' && (
          <VehiclesPanel
            vehicles={vehicles}
            loading={vehiclesLoading}
            userId={user.id}
            refresh={refreshVehicles}
            activeVehicleCount={activeVehicleCount}
          />
        )}
        {panel === 'reputation' && (
          <ReputationImpactPanel summary={summary} reputation={reputation} />
        )}
        {panel === 'settings' && <AccountSettingsPanel user={user} />}
      </main>

      <div className="profile-mobile-signout-wrap">
        <button className="profile-mobile-signout" type="button" onClick={handleSignOut} disabled={signingOut}>
          <IconLogOut size={16} /> {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        {signOutError && <p className="profile-mobile-signout-error" role="alert">{signOutError}</p>}
      </div>
    </div>
  );
}

// ---------- OVERVIEW ----------

function OverviewPanel({ user, summary, reputation, vehicles, activeVehicleCount, onOpenImpact }) {
  const hasEmergencyContact = Boolean(user.emergencyContact?.name && user.emergencyContact?.phone);
  const hostEligibility = reputation ? {
    eligible: !reputation.hold && (reputation.provisional || reputation.score >= REPUTATION_POLICY.hostMinimum)
  } : null;

  return (
    <>
      <div className="panel-head"><h2>Overview</h2><p>Everything about your account and standing, at a glance</p></div>

      <div className="grid-3">
        <div className="card snap-card">
          <span className="snap-icon"><IconStar size={16} /></span>
          <div>
            <div className="snap-value">{reputation ? reputation.score : '—'}</div>
            <div className="snap-label">Reputation score</div>
          </div>
        </div>
        <div className="card snap-card">
          <span className="snap-icon"><IconMedal size={16} /></span>
          <div>
            <div className="snap-value">{reputation ? reputation.standing.label : '—'}</div>
            <div className="snap-label">Trust standing{reputation?.provisional ? ' · first 3 rides are provisional' : ''}</div>
          </div>
        </div>
        <div className="card snap-card">
          <span className="snap-icon"><IconCar size={16} /></span>
          <div>
            <div className="snap-value">{vehicles.length}</div>
            <div className="snap-label">Vehicles · {activeVehicleCount} active</div>
          </div>
        </div>
      </div>

      <ImpactEntryCard userId={user.id} onOpen={onOpenImpact} />

      <div className="card">
        <p className="card-title"><IconShield size={13} /> Account health</p>
        <p className="card-subtitle" style={{ marginBottom: 0 }}>
          {hostEligibility?.eligible
            ? reputation?.provisional
              ? 'New-member access is active while you build evidence through your first three rides. '
              : `Your score meets the ${REPUTATION_POLICY.hostMinimum}/100 Driver minimum. `
            : `Publishing is restricted below ${REPUTATION_POLICY.hostMinimum}/100 or during a safety hold. `}
          {hasEmergencyContact ? 'Emergency contact on file.' : 'No emergency contact on file yet.'}
        </p>
      </div>
    </>
  );
}


// ---------- INFO & SECURITY (merges Profile Info + Profile Picture + Emergency Contact) ----------

function InfoSecurityPanel({ user, onSaved }) {
  const [identityState, setIdentityState] = useState(null);
  const [identityError, setIdentityError] = useState('');

  useEffect(() => {
    let active = true;
    IdentityVerificationService.getStatus(user.id)
      .then((state) => active && setIdentityState(state))
      .catch((err) => active && setIdentityError(err.message || 'Your identity status could not be read.'));
    return () => { active = false; };
  }, [user.id]);

  return (
    <>
      <div className="panel-head"><h2>Info &amp; Security</h2><p>Your identity, photo, and emergency contact — saved together</p></div>
      <div className="grid-2">
        <div>
          <BasicInfoCard user={user} onSaved={onSaved} />
          {identityError
            ? <div className="card"><p className="card-title">Identity verification</p><div className="alert alert-error">{identityError}</div></div>
            : identityState && (
              <IdentityVerificationCard
                compact
                userId={user.id}
                state={identityState}
                onSubmitted={setIdentityState}
              />
            )}
          <LanguagePreferencesCard user={user} onSaved={onSaved} />
          <ChangePasswordCard userId={user.id} />
        </div>
        <div>
          <ProfilePhotoCard user={user} onSaved={onSaved} />
          <EmergencyContactCard user={user} onSaved={onSaved} />
          {import.meta.env.VITE_M2_SOS_ENABLED === 'true' && <TrustedFamilyCard />}
        </div>
      </div>
    </>
  );
}

function LanguagePreferencesCard({ user, onSaved }) {
  const [languages, setLanguages] = useState(user?.spokenLanguages || []);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setLanguages(user?.spokenLanguages || []), [user?.spokenLanguages]);

  function toggleLanguage(value) {
    setLanguages((current) => current.includes(value)
      ? current.filter((language) => language !== value)
      : [...current, value]);
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const updated = await ProfileService.updateSpokenLanguages(user.id, languages);
      onSaved(updated);
      setStatus({ type: 'success', text: 'Spoken languages updated.' });
    } catch (error) {
      setStatus({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title">Spoken languages</p>
      <p className="card-subtitle">Travellers can use one preferred language when searching for a compatible Host</p>
      {status && <div className={'alert ' + (status.type === 'error' ? 'alert-error' : 'alert-success')}>{status.text}</div>}
      <form onSubmit={handleSave}>
        <fieldset className="compatibility-option-grid">
          <legend className="sr-only">Languages you speak</legend>
          {SPOKEN_LANGUAGE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={languages.includes(option.value)}
                onChange={() => toggleLanguage(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving}>
          <IconSave size={14} /> {saving ? 'Saving…' : 'Save Languages'}
        </button>
      </form>
    </div>
  );
}

function BasicInfoCard({ user, onSaved }) {
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const updated = await ProfileService.updateProfileInfo(user.id, { fullName, email, phone });
      onSaved(updated);
      setStatus({ type: 'success', text: 'Profile updated.' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title">Basic information</p>
      <p className="card-subtitle">Name and contact details shown across the platform</p>

      {status && <div className={'alert ' + (status.type === 'error' ? 'alert-error' : 'alert-success')}>{status.text}</div>}

      <form onSubmit={handleSave}>
        <div className="field">
          <label>Full Name *</label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconUser size={14} /></span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label>Email Address *</label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconMail size={14} /></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label>Phone Number *</label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconPhone size={14} /></span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving}>
          <IconSave size={14} /> {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

// Deliberately its own form/card, separate from Basic Information: changing a
// password is a sensitive action and shouldn't ride along with a routine name/
// email/phone edit, and it requires the current password before Supabase (or
// the mock adapter) will accept a new one.
function ChangePasswordCard({ userId }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await ProfileService.changePassword(userId, { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setStatus({ type: 'success', text: 'Password updated.' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title">Change password</p>
      <p className="card-subtitle">Requires your current password</p>

      {status && <div className={'alert ' + (status.type === 'error' ? 'alert-error' : 'alert-success')}>{status.text}</div>}

      <form onSubmit={handleSave}>
        <div className="field">
          <label>Current Password *</label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconLock size={14} /></span>
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            <button type="button" className="toggle-visibility" onClick={() => setShowCurrent((s) => !s)}>
              {showCurrent ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
          </div>
        </div>
        <div className="field">
          <label>New Password *</label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconLock size={14} /></span>
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              minLength={8}
              required
            />
            <button type="button" className="toggle-visibility" onClick={() => setShowNew((s) => !s)}>
              {showNew ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
          </div>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving}>
          <IconLock size={14} /> {saving ? 'Updating…' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}

function ProfilePhotoCard({ user, onSaved }) {
  const [preview, setPreview] = useState(user?.profilePhotoUrl || null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setStatus(null);
    try {
      const updated = await ProfileService.updateProfilePhoto(user.id, file);
      const url = typeof updated === 'string' ? updated : updated?.profilePhotoUrl;
      setPreview(url);
      onSaved((prev) => ({ ...prev, profilePhotoUrl: url }));
      setStatus({ type: 'success', text: 'Profile picture updated.' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title">Profile picture</p>
      <p className="card-subtitle">JPG or PNG, under 5MB</p>
      {status && <div className={'alert ' + (status.type === 'error' ? 'alert-error' : 'alert-success')}>{status.text}</div>}
      <div className="avatar-upload">
        <div
          className="big-avatar"
          style={preview ? { backgroundImage: `url(${preview})`, border: '2px solid var(--teal)' } : undefined}
        >
          {!preview && (user?.fullName?.[0] || '?')}
        </div>
        <label className="btn-ghost" style={{ cursor: 'pointer' }}>
          <IconEdit size={12} /> {saving ? 'Uploading…' : 'Upload new photo'}
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} disabled={saving} />
        </label>
      </div>
    </div>
  );
}

function EmergencyContactCard({ user, onSaved }) {
  const [name, setName] = useState(user?.emergencyContact?.name || '');
  const [phone, setPhone] = useState(user?.emergencyContact?.phone || '');
  const [relationship, setRelationship] = useState(user?.emergencyContact?.relationship || '');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const updated = await ProfileService.updateEmergencyContact(user.id, { name, phone, relationship });
      onSaved(updated);
      setStatus({ type: 'success', text: 'Emergency contact saved.' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title"><IconAlertTriangle size={13} /> Emergency contact</p>
      <p className="card-subtitle">Used by the Module 2 SOS flow during an active ride</p>
      {status && <div className={'alert ' + (status.type === 'error' ? 'alert-error' : 'alert-success')}>{status.text}</div>}
      <form onSubmit={handleSave}>
        <div className="field">
          <label>Contact Name</label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconUser size={14} /></span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Delacroix" />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Contact Phone</label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconPhone size={14} /></span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+60 19-876 5432" />
          </div>
        </div>
        <div className="field">
          <label>Relationship</label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconHeart size={14} /></span>
            <input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. Spouse, Parent, Friend" />
          </div>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving}>
          <IconSave size={14} /> {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

// ---------- MY VEHICLES ----------

const emptyVehicleForm = { id: null, make: '', model: '', vehicleType: '', plate: '', colour: '', seats: 4, year: new Date().getFullYear() };

function VehiclesPanel({ vehicles, loading, userId, refresh, activeVehicleCount }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    try {
      const saved = await VehicleService.saveVehicle(userId, { ...form, seats: Number(form.seats), year: Number(form.year) });
      // The vehicle is stored either way; say so plainly when the category
      // could not be, rather than letting the chosen value disappear.
      setNotice(saved?.categoryPending
        ? 'Vehicle saved. The vehicle category was not stored — that upgrade is not deployed in this environment yet.'
        : '');
      setForm(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleActive(v) {
    await VehicleService.setActiveVehicle(userId, v.id, !v.active);
    refresh();
  }

  async function remove(v) {
    if (!confirm(`Remove ${v.make} ${v.model} (${v.plate})?`)) return;
    await VehicleService.removeVehicle(userId, v.id);
    refresh();
  }

  return (
    <>
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h2>My Vehicles</h2><p>Manage vehicles available for your rides</p></div>
        <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} onClick={() => { setError(''); setNotice(''); setForm(emptyVehicleForm); }}>
          <IconPlus size={13} /> Add Vehicle
        </button>
      </div>

      <div className="grid-3">
        <div className="card snap-card">
          <span className="snap-icon"><IconCar size={16} /></span>
          <div>
            <div className="snap-value">{vehicles.length}</div>
            <div className="snap-label">Total Vehicles</div>
          </div>
        </div>
        <div className="card snap-card">
          <span className="snap-icon"><IconCheckCircle size={16} /></span>
          <div>
            <div className="snap-value">{activeVehicleCount}</div>
            <div className="snap-label">Active</div>
          </div>
        </div>
        <div className="card snap-card">
          <span className="snap-icon"><IconUsers size={16} /></span>
          <div>
            <div className="snap-value">{vehicles.reduce((s, v) => s + v.seats, 0)}</div>
            <div className="snap-label">Total Seats</div>
          </div>
        </div>
      </div>

      {form && (
        <div className="card">
          <p className="card-title">{form.id ? 'Edit Vehicle' : 'Add Vehicle'}</p>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSave}>
            <div className="field"><label>Make</label><div className="input-wrap"><input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} required /></div></div>
            <div className="field"><label>Model</label><div className="input-wrap"><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required /></div></div>
            <div className="field"><label>Vehicle category</label><div className="input-wrap"><select value={form.vehicleType || ''} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} required><option value="">Choose a category</option>{VEHICLE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div></div>
            <div className="field"><label>Plate Number</label><div className="input-wrap"><input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} required /></div></div>
            <div className="field"><label>Colour</label><div className="input-wrap"><input value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })} /></div></div>
            <div className="field"><label>Seats available</label><div className="input-wrap"><input type="number" min="1" max="8" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} required /></div></div>
            <div className="field"><label>Year</label><div className="input-wrap"><input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} required /></div></div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }}>Save Vehicle</button>
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {notice && <div className="alert alert-info">{notice}</div>}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading vehicles…</p>
      ) : (
        vehicles.map((v) => (
          <div className="vehicle-card" key={v.id}>
            <div className="vehicle-top">
              <span className="vehicle-icon"><IconCar size={13} /></span>
              <span className="vehicle-name">{v.make} {v.model}</span>
              <span className={v.active ? 'badge-active' : 'badge-inactive'}>{v.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="vehicle-meta">{v.plate}</div>
            <div className="vehicle-meta">{[vehicleTypeLabel(v.vehicleType), v.colour, `${v.seats} seats available`, v.year].filter(Boolean).join(' · ')}</div>
            <div className="vehicle-actions">
              <button className="action-edit" onClick={() => { setError(''); setNotice(''); setForm(v); }}><IconEdit size={12} /> Edit</button>
              <button className="action-toggle" onClick={() => toggleActive(v)}>
                {v.active ? <><IconPause size={12} /> Deactivate</> : <><IconPlay size={12} /> Activate</>}
              </button>
              <button className="action-remove" onClick={() => remove(v)}><IconTrash size={12} /> Remove</button>
            </div>
          </div>
        ))
      )}

      {!loading && activeVehicleCount > 0 && (
        <div className="banner-ok"><IconCheckCircle size={15} /> {activeVehicleCount} active vehicle{activeVehicleCount > 1 ? 's' : ''} — ready to offer rides</div>
      )}
      {!loading && vehicles.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>No vehicles yet — add one to start hosting rides.</p>
      )}
    </>
  );
}

// ---------- REPUTATION & IMPACT (merges Reputation + Host Dashboard) ----------

function ReputationImpactPanel({ summary, reputation }) {
  if (!summary || !reputation) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;

  const maxForBar = summary.nextTier ? summary.nextTier.minScore : summary.compositeScore * 1.2;
  const pct = Math.min(100, Math.round((summary.compositeScore / maxForBar) * 100));

  return (
    <>
      <div className="panel-head"><h2>Reputation &amp; Impact</h2><p>Your trust score, badge tier, and what shapes both</p></div>
      <div className="grid-2">
        <div>
          <div className="card">
            <p className="card-title">Public reputation score</p>
            <p className="card-subtitle">Verified ride behaviour, separate from your rating and environmental impact. This is standing you keep, not points you collect.</p>
            <div className="rep-score">
              <span className="icon"><IconStar size={26} /></span>
              <span className="num">{reputation.score}</span>
              <span className="of">/ 100</span>
            </div>
            <div className={`reputation-standing reputation-standing-${reputation.standing.key}`}>
              {reputation.standing.label}{reputation.provisional ? ` · ${reputation.evidenceCount}/${REPUTATION_POLICY.minEvidenceRides} evidence rides` : ''}
            </div>
            <div className="reputation-thresholds">
              <span>Publish rides: {REPUTATION_POLICY.hostMinimum}+</span>
              <span>Request rides: {REPUTATION_POLICY.travellerMinimum}+</span>
            </div>
          </div>
          <div className="card">
            <p className="card-title" style={{ color: 'var(--ink)' }}>How the score changes</p>
            <ul className="reputation-rules">
              <li>Everyone starts at {REPUTATION_POLICY.baseScore}/100 &mdash; positive outcomes restore standing you have lost, they never bank above it</li>
              <li>Completed ride +1; on-time check-in +1</li>
              <li>4-star review +1; 5-star review +2</li>
              <li>Cancellation −1 to −6 depending on notice</li>
              <li>Verified no-show −10; confirmed conduct cases −8 to −20</li>
            </ul>
            <p className="card-subtitle reputation-login-note">Normal login does not add reputation points because it does not prove ride reliability.</p>
          </div>
          <div className="card">
            <p className="card-title">Recent reputation activity</p>
            {reputation.events.length ? (
              <ul className="reputation-event-list">
                {reputation.events.slice(0, 8).map((event) => (
                  <li key={event.id || `${event.type}-${event.createdAt}`}>
                    <div>
                      <strong>{describeReputationEvent(event.type)}</strong>
                      {event.createdAt && <span>{new Date(event.createdAt).toLocaleDateString('en-MY')}</span>}
                    </div>
                    <span className={event.delta >= 0 ? 'event-positive' : 'event-negative'}>{event.delta > 0 ? '+' : ''}{event.delta}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="card-subtitle" style={{ marginBottom: 0 }}>Your verified ride outcomes will appear here.</p>}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="impact-header">
              <div className="impact-badge-icon"><IconMedal size={19} /></div>
              <div>
                <div className="impact-badge">{summary.badge.name}</div>
                <div className="impact-owner">
                  {summary.badgeWithheld
                    ? `Higher tiers are held back until your reputation returns to ${REPUTATION_POLICY.hostMinimum}`
                    : 'Active perks below'}
                </div>
              </div>
            </div>
            <ul className="perk-list">
              {summary.badge.perks.map((p) => (
                <li key={p}><span className="perk-check"><IconCheck size={12} /></span>{p}</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <p className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><IconBolt size={13} /> Impact score formula</p>
            <div className="formula-row">
              <span className="formula-icon"><IconCar size={14} /></span>
              <div><div className="formula-value">{summary.completedTrips}</div><div className="formula-label">Completed Trips</div></div>
              <span className="formula-weight">× {summary.weights.trips.toFixed(1)}</span>
            </div>
            <div className="formula-row">
              <span className="formula-icon"><IconLeaf size={14} /></span>
              <div><div className="formula-value">{summary.co2SavedKg}</div><div className="formula-label">CO₂ Saved (kg)</div></div>
              <span className="formula-weight">× {summary.weights.co2.toFixed(1)}</span>
            </div>
            <p className="card-subtitle" style={{ marginTop: 8 }}>
              Reputation is not part of this total &mdash; it decides whether a tier is shown at all, not how large the score is.
            </p>
            <div className="composite-bar">
              <p className="card-title" style={{ marginBottom: 0 }}>Composite Impact Score</p>
              <div className="composite-track"><div className="composite-fill" style={{ width: pct + '%' }} /></div>
              <div className="composite-label">
                <span>{summary.compositeScore}</span>
                <span>{summary.nextTier ? `${summary.nextTier.pointsToNext} pts to ${summary.nextTier.name}` : 'Top tier reached'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- ACCOUNT SETTINGS ----------
// Deactivation is reversible on the next successful login. Hard deletion is
// intentionally deferred until it can remove the Supabase Auth identity too.

const PROFILE_VISIBILITY_OPTIONS = [
  { key: 'showProfilePhoto', label: 'Profile photo', description: 'Show your photo on your public profile.' },
  { key: 'showSpokenLanguages', label: 'Spoken languages', description: 'Help people understand how they can communicate with you.' },
  { key: 'showCompletedTrips', label: 'Completed ride count', description: 'Show your verified experience without exposing ride details.' },
  { key: 'showEcoImpact', label: 'CO₂ impact', description: 'Share your total estimated environmental contribution.' }
];

function ProfileVisibilityCard({ user }) {
  const [visibility, setVisibility] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [shareMessage, setShareMessage] = useState('');

  useEffect(() => {
    let active = true;
    ProfileService.getProfileVisibility(user.id)
      .then((value) => active && setVisibility(value))
      .catch((loadError) => active && setError(loadError.message));
    return () => { active = false; };
  }, [user.id]);

  async function save() {
    setSaving(true);
    setMessage('');
    setShareMessage('');
    setError('');
    try {
      const saved = await ProfileService.updateProfileVisibility(user.id, visibility);
      setVisibility(saved);
      setMessage('Public profile visibility saved.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function shareProfile() {
    setShareMessage('');
    setError('');
    try {
      const result = await sharePublicProfile({
        userId: user.id,
        displayName: user.fullName || user.name || 'My profile',
      });
      if (result.method === 'copied') setShareMessage('Profile link copied.');
      if (result.method === 'shared') setShareMessage('Profile shared.');
    } catch (shareError) {
      setError(shareError.message || 'Unable to share your profile.');
    }
  }

  return (
    <div className="card profile-visibility-card">
      <div className="profile-visibility-head">
        <div>
          <p className="card-title">Public profile visibility</p>
          <p className="card-subtitle">Only your shortened name, rating, reputation and member status are always shown. Email, phone and emergency contact are never public.</p>
        </div>
        <div className="profile-visibility-actions">
          <button className="btn-outline" type="button" onClick={() => { void shareProfile(); }}>Share profile</button>
          <Link className="btn-outline" to={`/users/${user.id}`}>Preview</Link>
        </div>
      </div>
      {!visibility ? <p className="card-subtitle">Loading visibility settings…</p> : (
        <div className="profile-visibility-list">
          {PROFILE_VISIBILITY_OPTIONS.map((option) => (
            <label className="profile-visibility-row" key={option.key}>
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
              <input
                type="checkbox"
                role="switch"
                checked={Boolean(visibility[option.key])}
                onChange={(event) => {
                  setVisibility((current) => ({ ...current, [option.key]: event.target.checked }));
                  setMessage('');
                }}
              />
            </label>
          ))}
        </div>
      )}
      <p className="profile-visibility-note">For safety, an active Driver’s name, reputation, rating and ride-card identity remain visible on published rides.</p>
      {visibility?.deploymentPending && <div className="alert alert-info">These controls are previewing defaults until database migration 073 is deployed.</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {shareMessage && <div className="alert alert-success" role="status">{shareMessage}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <Button onClick={save} loading={saving} loadingLabel="Saving" disabled={!visibility}>Save visibility</Button>
    </div>
  );
}

function AccountSettingsPanel({ user }) {
  const { signOut } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const deactivateTriggerRef = useRef(null);

  function openConfirm() {
    setError('');
    setConfirm(true);
  }

  async function handleDeactivate() {
    setBusy(true);
    setError('');
    try {
      await ProfileService.deactivateAccount(user.id);
      await signOut();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel-head"><h2>Account Settings</h2></div>

      <SoundPreferences card />

      <ProfileVisibilityCard user={user} />

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="settings-row settings-row-last">
          <div>
            <p className="card-title" style={{ marginBottom: 4 }}>Deactivate Account</p>
            <p className="card-subtitle" style={{ marginBottom: 0 }}>Temporarily hides your profile and pauses ride hosting. You can reactivate by logging back in.</p>
          </div>
          <button ref={deactivateTriggerRef} className="btn-outline btn-outline-warning" onClick={openConfirm}>Deactivate</button>
        </div>
      </div>

      <p className="settings-help">Need help? Contact <a href="mailto:support@letstumpang.my">support@letstumpang.my</a></p>

      <AdaptiveDialog
        open={confirm}
        onClose={() => { if (!busy) setConfirm(false); }}
        title="Deactivate your account?"
        description="This is reversible the next time you sign in."
        triggerRef={deactivateTriggerRef}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Go back</Button>
            <Button variant="danger" onClick={handleDeactivate} loading={busy} loadingLabel="Deactivating">Deactivate</Button>
          </>
        )}
      >
        <div className="profile-deactivate-warning">
          <IconAlertTriangle size={22} aria-hidden="true" />
          <p>Your profile will be hidden and ride hosting paused until you sign in again.</p>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
      </AdaptiveDialog>
    </>
  );
}
