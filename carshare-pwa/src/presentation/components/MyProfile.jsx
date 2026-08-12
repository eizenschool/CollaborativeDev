// ===== PRESENTATION LAYER (MyProfile) =====
// Consolidates Profile Settings, My Vehicles, Reputation, Host Dashboard, and
// Account Settings into one "My Profile" page: a sidebar (compact reputation
// hero card + section rail) plus a content panel, matching the approved UX
// reference. All five screens are Module 1 data about the same user, so this
// is one read/write surface instead of five.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { ProfileService } from '../../business-logic/ProfileService.js';
import { VehicleService } from '../../business-logic/VehicleService.js';
import { HostImpactEngine } from '../../business-logic/HostImpactEngine.js';
import {
  IconUser, IconMail, IconPhone, IconLock, IconEye, IconEyeOff, IconSave, IconHeart,
  IconCar, IconPlus, IconEdit, IconTrash, IconPause, IconPlay, IconCheckCircle,
  IconMedal, IconCheck, IconTrendUp, IconTrendDown, IconBolt, IconLeaf, IconStar,
  IconLayers, IconShield, IconAlertTriangle, IconRoute, IconSettings, IconCamera, IconChart
} from './icons.jsx';

const REPUTATION_THRESHOLD = 60; // minimum reputation score required to publish rides (admin-configurable)

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
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [panel, setPanel] = useState('overview');
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [summary, setSummary] = useState(null);

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
    setSummary(await HostImpactEngine.getImpactSummary(user.id));
  }

  if (!user) return null;

  const activeVehicleCount = vehicles.filter((v) => v.active).length;
  const initials = initialsOf(user.fullName);

  return (
    <div className="profile-page">
      <aside className="profile-sidebar">
        <div className="hero-card">
          <div className="hero-card-avatar-wrap">
            <div
              className="hero-card-avatar"
              style={user.profilePhotoUrl ? { backgroundImage: `url(${user.profilePhotoUrl})` } : undefined}
            >
              {!user.profilePhotoUrl && initials}
            </div>
            <button className="hero-card-camera" onClick={() => setPanel('info')} title="Change photo" type="button">
              <IconCamera size={13} />
            </button>
          </div>
          <div className="hero-card-name">{user.fullName}</div>
          {summary && (
            <div className="hero-card-meta-row">
              <span className="hero-card-rating"><IconStar size={13} /> {summary.reputationScore}/100</span>
              <span className="hero-card-tier"><IconMedal size={11} /> {summary.badge.name.replace(' Host', '')}</span>
            </div>
          )}
          {summary && (
            <div className="rep-bar">
              <div className="rep-bar-track"><div className="rep-bar-fill" style={{ width: summary.reputationScore + '%' }} /></div>
              <div className="rep-bar-labels"><span>Reputation score</span><span>{summary.reputationScore}/100</span></div>
            </div>
          )}
        </div>

        <nav className="rail-card">
          {RAIL_ITEMS.map(({ id, label, Icon }) => (
            <button key={id} className={'rail-item' + (panel === id ? ' active' : '')} onClick={() => setPanel(id)}>
              <span className="rail-icon"><Icon size={14} /></span> {label}
            </button>
          ))}
        </nav>
        <p className="rail-note">Reputation, badge tier, and vehicle status are read-only here — they're calculated from Module 5 &amp; 6 trip data.</p>
      </aside>

      <main className="panels">
        {panel === 'overview' && (
          <OverviewPanel
            user={user}
            summary={summary}
            vehicles={vehicles}
            activeVehicleCount={activeVehicleCount}
            goTo={setPanel}
            onPublishRide={() => navigate('/ride/publish')}
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
          <ReputationImpactPanel user={user} summary={summary} refresh={refreshImpact} />
        )}
        {panel === 'settings' && <AccountSettingsPanel user={user} />}
      </main>
    </div>
  );
}

// ---------- OVERVIEW ----------

function OverviewPanel({ user, summary, vehicles, activeVehicleCount, goTo, onPublishRide, onOpenImpact }) {
  const hasEmergencyContact = Boolean(user.emergencyContact?.name && user.emergencyContact?.phone);
  const meetsThreshold = summary ? summary.reputationScore >= REPUTATION_THRESHOLD : true;

  return (
    <>
      <div className="panel-head"><h2>Overview</h2><p>Everything about your account and standing, at a glance</p></div>

      <div className="grid-3">
        <div className="card snap-card">
          <span className="snap-icon"><IconStar size={16} /></span>
          <div>
            <div className="snap-value">{summary ? summary.reputationScore : '—'}</div>
            <div className="snap-label">Reputation score</div>
          </div>
        </div>
        <div className="card snap-card">
          <span className="snap-icon"><IconMedal size={16} /></span>
          <div>
            <div className="snap-value">{summary ? summary.badge.name.replace(' Host', '') : '—'}</div>
            <div className="snap-label">Host tier{summary?.nextTier ? ` · ${summary.nextTier.pointsToNext} pts to ${summary.nextTier.name.replace(' Host', '')}` : ''}</div>
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

      <ImpactEntryCard onOpenImpact={onOpenImpact} />

      <div className="card">
        <p className="card-title">Quick actions</p>
        <p className="card-subtitle">Common tasks, one click from wherever you land on your profile</p>
        <div className="quick-actions">
          <button className="qa-btn" onClick={() => goTo('info')}><IconEdit size={12} /> Edit profile info</button>
          <button className="qa-btn" onClick={() => goTo('vehicles')}><IconPlus size={12} /> Add a vehicle</button>
          <button className="qa-btn" onClick={() => goTo('reputation')}><IconBolt size={12} /> See impact breakdown</button>
          <button className="qa-btn primary" onClick={onPublishRide}>
            <IconRoute size={12} /> Publish new ride
          </button>
        </div>
      </div>

      <div className="card">
        <p className="card-title"><IconShield size={13} /> Account health</p>
        <p className="card-subtitle" style={{ marginBottom: 0 }}>
          {meetsThreshold
            ? 'Reputation above minimum threshold — ride publishing is unrestricted. '
            : `Reputation below the ${REPUTATION_THRESHOLD}/100 minimum threshold — ride publishing is restricted. `}
          {hasEmergencyContact ? 'Emergency contact on file.' : 'No emergency contact on file yet.'}
        </p>
      </div>
    </>
  );
}

function ImpactEntryCard({ onOpenImpact }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onOpenImpact}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        textAlign: 'left',
        background: 'linear-gradient(135deg, #ECFDF5 0%, #F0FDFA 100%)',
        border: '1.5px solid #A7F3D0',
        borderLeft: '5px solid #0D9488',
        borderRadius: 16,
        padding: '18px 20px',
        marginBottom: 16,
        cursor: 'pointer',
        boxShadow: hover ? '0px 10px 28px rgba(13,148,136,0.18)' : '0px 3px 12px rgba(13,148,136,0.10)',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'all 0.15s ease'
      }}
    >
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #16A34A, #0D9488)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: '#FFFFFF',
          boxShadow: '0px 4px 12px rgba(13,148,136,0.25)'
        }}
      >
        <IconLeaf size={22} />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 16, color: '#111827' }}>
            My Impact &amp; Trip History
          </span>
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: '#0D9488',
              background: '#CCFBF1',
              padding: '2px 8px',
              borderRadius: 999
            }}
          >
            Eco
          </span>
        </span>
        <span style={{ display: 'block', fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#374151', marginTop: 3 }}>
          View CO₂ saved, ride history &amp; monthly leaderboard
        </span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0D9488" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

// ---------- INFO & SECURITY (merges Profile Info + Profile Picture + Emergency Contact) ----------

function InfoSecurityPanel({ user, onSaved }) {
  return (
    <>
      <div className="panel-head"><h2>Info &amp; Security</h2><p>Your identity, photo, and emergency contact — saved together</p></div>
      <div className="grid-2">
        <BasicInfoCard user={user} onSaved={onSaved} />
        <div>
          <ProfilePhotoCard user={user} onSaved={onSaved} />
          <EmergencyContactCard user={user} onSaved={onSaved} />
        </div>
      </div>
    </>
  );
}

function BasicInfoCard({ user, onSaved }) {
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [newPassword, setNewPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const updated = await ProfileService.updateProfileInfo(user.id, { fullName, email, phone, newPassword });
      onSaved(updated);
      setNewPassword('');
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
        <div className="field">
          <label>New Password <span className="hint">(leave blank to keep current)</span></label>
          <div className="input-wrap">
            <span className="prefix-icon"><IconLock size={14} /></span>
            <input
              type={showPw ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button type="button" className="toggle-visibility" onClick={() => setShowPw((s) => !s)}>
              {showPw ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
          </div>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving}>
          <IconSave size={14} /> {saving ? 'Saving…' : 'Save Changes'}
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
      <p className="card-subtitle">Used by the Panic Button (Module 6) during an active trip</p>
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

const emptyVehicleForm = { id: null, make: '', model: '', plate: '', colour: '', seats: 4, year: new Date().getFullYear() };

function VehiclesPanel({ vehicles, loading, userId, refresh, activeVehicleCount }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    try {
      await VehicleService.saveVehicle(userId, { ...form, seats: Number(form.seats), year: Number(form.year) });
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
        <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} onClick={() => { setError(''); setForm(emptyVehicleForm); }}>
          <IconPlus size={13} /> Add Vehicle
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="stat-row"><span className="stat-value">{vehicles.length}</span><span className="stat-label">Total Vehicles</span></div>
        <div className="stat-row"><span className="stat-value">{activeVehicleCount}</span><span className="stat-label">Active</span></div>
        <div className="stat-row" style={{ borderBottom: 'none' }}><span className="stat-value">{vehicles.reduce((s, v) => s + v.seats, 0)}</span><span className="stat-label">Total Seats</span></div>
      </div>

      {form && (
        <div className="card">
          <p className="card-title">{form.id ? 'Edit Vehicle' : 'Add Vehicle'}</p>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSave}>
            <div className="field"><label>Make</label><div className="input-wrap"><input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} required /></div></div>
            <div className="field"><label>Model</label><div className="input-wrap"><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required /></div></div>
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
            <div className="vehicle-meta">{v.colour} · {v.seats} seats available · {v.year}</div>
            <div className="vehicle-actions">
              <button className="action-edit" onClick={() => setForm(v)}><IconEdit size={12} /> Edit</button>
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

function ReputationImpactPanel({ user, summary, refresh }) {
  if (!summary) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;

  const maxForBar = summary.nextTier ? summary.nextTier.minScore : summary.compositeScore * 1.2;
  const pct = Math.min(100, Math.round((summary.compositeScore / maxForBar) * 100));

  async function adjust(trips, reputation) {
    await HostImpactEngine.applyDemoAdjustment(user.id, { trips, reputation });
    refresh();
  }

  return (
    <>
      <div className="panel-head"><h2>Reputation &amp; Impact</h2><p>Your trust score, badge tier, and what shapes both</p></div>
      <div className="grid-2">
        <div>
          <div className="card">
            <p className="card-title">Public reputation score</p>
            <p className="card-subtitle">Shown to other riders and hosts before a trip is confirmed</p>
            <div className="rep-score">
              <span className="icon"><IconStar size={26} /></span>
              <span className="num">{summary.reputationScore}</span>
              <span className="of">/ 100</span>
            </div>
          </div>
          <div className="card">
            <p className="card-title" style={{ color: 'var(--ink)' }}>Coming from Module 6</p>
            <p className="card-subtitle" style={{ marginBottom: 0 }}>
              Trip-by-trip rating history and dispute detail live in Trip Verification &amp; Safety, and feed this score automatically.
            </p>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="impact-header">
              <div className="impact-badge-icon"><IconMedal size={19} /></div>
              <div>
                <div className="impact-badge">{summary.badge.name}</div>
                <div className="impact-owner">Active perks below</div>
              </div>
            </div>
            <ul className="perk-list">
              {summary.badge.perks.map((p) => (
                <li key={p}><span className="perk-check"><IconCheck size={12} /></span>{p}</li>
              ))}
            </ul>

            {HostImpactEngine.backend === 'mock' && (
              <div className="demo-controls" style={{ marginTop: 16 }}>
                <p className="card-title">Demo controls</p>
                <button className="btn-block demo-up" onClick={() => adjust(5, 3)}><IconTrendUp size={14} /> +5 trips, +3 rep score</button>
                <button className="btn-block demo-down" onClick={() => adjust(-8, -12)}><IconTrendDown size={14} /> −8 trips, −12 rep score</button>
                <button className="demo-reset" onClick={() => alert('Clear localStorage (key: letstumpang_mock_db_v1) to reset all demo data.')}>Reset to defaults</button>
              </div>
            )}
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
            <div className="formula-row">
              <span className="formula-icon"><IconStar size={14} /></span>
              <div><div className="formula-value">{summary.reputationScore}</div><div className="formula-label">Reputation Score</div></div>
              <span className="formula-weight">× {summary.weights.reputation.toFixed(1)}</span>
            </div>
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

function AccountSettingsPanel({ user }) {
  const { signOut } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="settings-row settings-row-last">
          <div>
            <p className="card-title" style={{ marginBottom: 4 }}>Deactivate Account</p>
            <p className="card-subtitle" style={{ marginBottom: 0 }}>Temporarily hides your profile and pauses ride hosting. You can reactivate by logging back in.</p>
          </div>
          <button className="btn-outline btn-outline-warning" onClick={openConfirm}>Deactivate</button>
        </div>
      </div>

      <p className="settings-help">Need help? Contact <a href="mailto:support@letstumpang.my">support@letstumpang.my</a></p>

      {confirm && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirm(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon"><IconAlertTriangle size={20} /></div>
            <p className="modal-title">Deactivate your account?</p>
            <p className="modal-text">Your profile will be hidden and ride hosting paused until you log back in.</p>
            {error && <div className="alert alert-error" style={{ textAlign: 'left' }}>{error}</div>}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Go Back</button>
              <button
                className="btn-danger-solid"
                onClick={handleDeactivate}
                disabled={busy}
              >
                {busy ? 'Please wait…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
