// ===== PRESENTATION LAYER (UnmetDemandView) =====
// UC6.7 / FR-6.34 - where people want to go that nobody is driving to.
//
// The demand side of the platform shown to the supply side. Everything else in
// this module answers "where should I go?"; this screen answers "where would a
// ride I publish actually get filled?", which is a different question for a
// different person.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../../business-logic/discovery/DestinationDiscoveryService.js';
import { todayIso } from '../../../business-logic/discovery/localDate.js';
import { IconArrowLeft, IconUsers, IconRoute, IconMapPin } from '../icons.jsx';
import PlaceImage from './PlaceImage.jsx';
import AudienceSwitch from './AudienceSwitch.jsx';
import DemoControls, { DemoActiveBanner } from './DemoControls.jsx';

const DEFAULT_ORIGIN = { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' };
const today = todayIso;

export default function UnmetDemandView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const demo = searchParams.get('demo') === '1';

  // Carried from whichever screen linked here, so the Host sees demand for the
  // date they were already looking at rather than being silently reset to today.
  const [travelDate, setTravelDate] = useState(() => searchParams.get('date') || today());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (date) => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await DestinationDiscoveryService.getUnmetDemand({
        userId: user?.id, travelDate: date, origin: DEFAULT_ORIGIN
      });
      setRows(data);
    } catch (cause) {
      // Same reasoning as DiscoverHub: this screen is one link away from it and
      // failed the same way, sitting on "Checking demand…" for a signed-out
      // reader the live catalogue will never answer.
      console.error('Unmet demand lookup failed', cause);
      setFailed(true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { load(travelDate); }, [load, travelDate]);

  return (
    <div className="dsc-page">
      <button className="dsc-back" onClick={() => navigate('/discover')} type="button">
        <IconArrowLeft size={16} /> Back to destinations
      </button>

      <header className="dsc-header">
        <h1>Where people want to go</h1>
        <p>
          Destinations with interest and no ride serving them. Publish one of
          these and the seats are more likely to fill.
        </p>
      </header>

      <AudienceSwitch active="demand" travelDate={travelDate} demo={demo} />
      <DemoActiveBanner />

      {demo && (
        <DemoControls
          travelDate={travelDate}
          onTravelDateChange={setTravelDate}
          onChanged={() => load(travelDate)}
        />
      )}

      <div className="dsc-controls">
        <label className="dsc-field">
          <span>Travel date</span>
          <input
            type="date"
            value={travelDate}
            onChange={(event) => setTravelDate(event.target.value)}
          />
        </label>
      </div>

      {loading && <p className="dsc-empty">Checking demand…</p>}

      {/* "Nothing needs a driver" is a strong claim to make about a read that
          never returned - it would send a Host away believing the work is done. */}
      {!loading && failed && (
        <div className="dsc-empty dsc-failed" role="alert">
          {user ? (
            <>
              <p className="dsc-failed-title">We could not check demand.</p>
              <p>The place catalogue did not respond. It may be a connection problem.</p>
              <button type="button" className="dsc-failed-action" onClick={() => load(travelDate)}>
                Try again
              </button>
            </>
          ) : (
            <>
              <p className="dsc-failed-title">Sign in to see where people want to go.</p>
              <p>Demand is available to signed-in members.</p>
              <button
                type="button"
                className="dsc-failed-action"
                onClick={() => navigate('/auth', {
                  state: {
                    from: `/discover/demand?date=${travelDate}`,
                    reason: 'Sign in to see where people want to go.'
                  }
                })}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      )}

      {!loading && !failed && rows.length === 0 && (
        <p className="dsc-empty">
          Every destination people want on this date is already covered by a ride
          with a seat left. Nothing here needs another driver.
        </p>
      )}

      {!loading && !failed && rows.length > 0 && (
        <div className="dsc-list">
          {rows.map((row) => (
            <article className="dsc-card dsc-card-unserved" key={row.placeId}>
              <span className="dsc-card-media">
                <PlaceImage place={row.place} widthPx={600} />
              </span>

              <span className="dsc-card-body">
                <span className="dsc-card-head">
                  <h3 className="dsc-card-title">{row.place.name}</h3>
                  <span className="dsc-chip">{row.place.category}</span>
                </span>

                <span className="dsc-card-meta">
                  <span className="dsc-meta-item"><IconMapPin size={14} /> {row.place.state}</span>
                  {Number.isFinite(row.distanceKm) && (
                    <span className="dsc-meta-item">{Math.round(row.distanceKm)} km</span>
                  )}
                </span>

                <span className="dsc-availability dsc-unserved">
                  <IconUsers size={16} />
                  <span>
                    <strong>{row.interestedUsers}</strong>{' '}
                    {row.interestedUsers === 1 ? 'person wants' : 'people want'} to go on {travelDate}
                  </span>
                </span>

                <span className="dsc-actions">
                  <button
                    className="dsc-btn dsc-btn-primary"
                    type="button"
                    onClick={() => navigate(DestinationDiscoveryService.buildPrefillUrl(
                      'publish', row.place, { origin: DEFAULT_ORIGIN, travelDate }
                    ))}
                  >
                    <IconRoute size={16} /> Publish a ride here
                  </button>
                  <button
                    className="dsc-btn"
                    type="button"
                    onClick={() => navigate(`/discover/${row.placeId}?date=${travelDate}`)}
                  >
                    View destination
                  </button>
                </span>
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
