// ===== PRESENTATION LAYER (ProfileSettings) =====
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { ProfileService } from '../../business-logic/ProfileService.js';

export default function ProfileSettings() {
  const { user, setUser } = useAuth();
  const [tab, setTab] = useState('info'); // 'info' | 'photo' | 'emergency'

  return (
    <>
      <div className="content-header">
        <h1>Profile Settings</h1>
        <p>Update your name, contact details, and password</p>
      </div>
      <div className="content-body">
        <div className="tabs">
          <button className={'tab' + (tab === 'info' ? ' active' : '')} onClick={() => setTab('info')}>Profile Info</button>
          <button className={'tab' + (tab === 'photo' ? ' active' : '')} onClick={() => setTab('photo')}>Profile Picture</button>
          <button className={'tab' + (tab === 'emergency' ? ' active' : '')} onClick={() => setTab('emergency')}>Emergency Contact</button>
        </div>

        {tab === 'info' && <ProfileInfoForm user={user} onSaved={setUser} />}
        {tab === 'photo' && <ProfilePhotoForm user={user} onSaved={setUser} />}
        {tab === 'emergency' && <EmergencyContactForm user={user} onSaved={setUser} />}
      </div>
    </>
  );
}

function ProfileInfoForm({ user, onSaved }) {
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
      <p className="card-title">Profile Information</p>
      <p className="card-subtitle">Update your name, contact details, and password</p>

      {status && <div className={'alert ' + (status.type === 'error' ? 'alert-error' : 'alert-success')}>{status.text}</div>}

      <form onSubmit={handleSave}>
        <div className="field">
          <label>Full Name *</label>
          <div className="input-wrap">
            <span className="prefix-icon">👤</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label>Email Address *</label>
          <div className="input-wrap">
            <span className="prefix-icon">✉</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label>Phone Number *</label>
          <div className="input-wrap">
            <span className="prefix-icon">📞</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label>New Password <span className="hint">(leave blank to keep current)</span></label>
          <div className="input-wrap">
            <span className="prefix-icon">🔒</span>
            <input
              type={showPw ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button type="button" className="toggle-visibility" onClick={() => setShowPw((s) => !s)}>
              {showPw ? '🙈' : '👁'}
            </button>
          </div>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving}>
          💾 {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

function ProfilePhotoForm({ user, onSaved }) {
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
      setPreview(typeof updated === 'string' ? updated : updated?.profilePhotoUrl);
      onSaved((prev) => ({ ...prev, profilePhotoUrl: typeof updated === 'string' ? updated : updated?.profilePhotoUrl }));
      setStatus({ type: 'success', text: 'Profile picture updated.' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title">Profile Picture</p>
      <p className="card-subtitle">A clear photo helps riders and hosts recognise each other</p>
      {status && <div className={'alert ' + (status.type === 'error' ? 'alert-error' : 'alert-success')}>{status.text}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div className="avatar-dot" style={{ width: 72, height: 72, fontSize: 22, background: 'var(--teal-tint)', color: 'var(--teal-dark)', backgroundImage: preview ? `url(${preview})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center' }}>
          {!preview && (user?.fullName?.[0] || '?')}
        </div>
        <label className="btn-secondary" style={{ cursor: 'pointer' }}>
          {saving ? 'Uploading…' : 'Upload photo'}
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} disabled={saving} />
        </label>
      </div>
    </div>
  );
}

function EmergencyContactForm({ user, onSaved }) {
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
      <p className="card-title">Emergency Contact</p>
      <p className="card-subtitle">Used by the Panic Button (Module 6) to send a pre-filled alert while the app is open</p>
      {status && <div className={'alert ' + (status.type === 'error' ? 'alert-error' : 'alert-success')}>{status.text}</div>}
      <form onSubmit={handleSave}>
        <div className="field">
          <label>Contact Name</label>
          <div className="input-wrap">
            <span className="prefix-icon">👤</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Delacroix" />
          </div>
        </div>
        <div className="field">
          <label>Contact Phone</label>
          <div className="input-wrap">
            <span className="prefix-icon">📞</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0199" />
          </div>
        </div>
        <div className="field">
          <label>Relationship</label>
          <div className="input-wrap">
            <span className="prefix-icon">❤</span>
            <input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="e.g. Spouse, Parent, Friend" />
          </div>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving}>
          💾 {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}
