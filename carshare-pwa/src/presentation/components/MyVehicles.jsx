// ===== PRESENTATION LAYER (MyVehicles) =====
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { VehicleService } from '../../business-logic/VehicleService.js';
import { IconCar, IconPlus, IconEdit, IconTrash, IconPause, IconPlay, IconCheckCircle } from './icons.jsx';

const emptyForm = { id: null, make: '', model: '', plate: '', colour: '', seats: 4, year: new Date().getFullYear() };

export default function MyVehicles() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // null = hidden, object = editing/adding
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  async function refresh() {
    setLoading(true);
    try {
      setVehicles(await VehicleService.listVehicles(user.id));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    try {
      await VehicleService.saveVehicle(user.id, { ...form, seats: Number(form.seats), year: Number(form.year) });
      setForm(null);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleActive(v) {
    await VehicleService.setActiveVehicle(user.id, v.id, !v.active);
    refresh();
  }

  async function remove(v) {
    if (!confirm(`Remove ${v.make} ${v.model} (${v.plate})?`)) return;
    await VehicleService.removeVehicle(user.id, v.id);
    refresh();
  }

  const activeCount = vehicles.filter((v) => v.active).length;

  return (
    <>
      <div className="content-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>My Vehicles</h1>
          <p>Manage vehicles available for your rides</p>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 18px' }} onClick={() => { setError(''); setForm(emptyForm); }}>
          <IconPlus size={15} /> Add Vehicle
        </button>
      </div>

      <div className="content-body">
        <div className="stat-row"><span className="stat-value">{vehicles.length}</span><span className="stat-label">Total Vehicles</span></div>
        <div className="stat-row"><span className="stat-value">{activeCount}</span><span className="stat-label">Active</span></div>
        <div className="stat-row"><span className="stat-value">{vehicles.reduce((s, v) => s + v.seats, 0)}</span><span className="stat-label">Total Seats</span></div>

        <div style={{ height: 16 }} />

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
                <span className="vehicle-icon"><IconCar size={16} /></span>
                <span className="vehicle-name">{v.make} {v.model}</span>
                <span className={v.active ? 'badge-active' : 'badge-inactive'}>{v.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="vehicle-meta">{v.plate}</div>
              <div className="vehicle-meta">{v.colour} · {v.seats} seats available · {v.year}</div>
              <div className="vehicle-actions">
                <button className="action-edit" onClick={() => setForm(v)}><IconEdit size={14} /> Edit</button>
                <button className="action-toggle" onClick={() => toggleActive(v)}>
                  {v.active ? <><IconPause size={14} /> Deactivate</> : <><IconPlay size={14} /> Activate</>}
                </button>
                <button className="action-remove" onClick={() => remove(v)}><IconTrash size={14} /> Remove</button>
              </div>
            </div>
          ))
        )}

        {!loading && activeCount > 0 && (
          <div className="banner-ok"><IconCheckCircle size={16} /> {activeCount} active vehicle{activeCount > 1 ? 's' : ''} — ready to offer rides</div>
        )}
        {!loading && vehicles.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No vehicles yet — add one to start hosting rides.</p>
        )}
      </div>
    </>
  );
}
