// ===== PRESENTATION LAYER (UnmetDemandView) =====
// UC6.7 / FR-6.34 - destinations with browsing interest and no available
// listed seat for the selected date.
//
// The demand side of the platform shown to the supply side. Everything else in
// this module answers "where should I go?"; this screen answers "where would a
// ride I publish actually get filled?", which is a different question for a
// different person.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../shared/context/AuthContext.jsx';
import { DestinationDiscoveryService } from '../../../../business-logic/m6-discovery/discovery/DestinationDiscoveryService.js';
import { discoveryFilters, readExploreReturn, readOrigin } from '../../../../business-logic/m6-discovery/discovery/DiscoveryJourney.js';
import { todayIso } from '../../../../business-logic/m6-discovery/discovery/localDate.js';
import { IconArrowLeft, IconUsers, IconRoute, IconMapPin } from '../../../shared/components/icons.jsx';
import { PHOTO_WIDTH_CARD } from '../../../../business-logic/m6-discovery/discovery/placePhotos.js';
import PlaceImage from './PlaceImage.jsx';
import AudienceSwitch from './AudienceSwitch.jsx';
import DemoControls, { DemoActiveBanner } from './DemoControls.jsx';

export const DEMAND_LOAD_TIMEOUT_MS = 12000;

function withTimeout(task, timeoutMs = DEMAND_LOAD_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    task,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Demand lookup timed out.')), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

export default function UnmetDemandView() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const demo = searchParams.get('demo') === '1';
  const travelDate = discoveryFilters(searchParams).date;
  // readOrigin returns a fresh object. Keeping the page's starting point in
  // state prevents the load effect from treating every result render as a new
  // request and leaving the demand view stuck on its loading message.
  const [origin] = useState(() => readOrigin());

  // Carried from whichever screen linked here, so the Host sees demand for the
  // date they were already looking at rather than being silently reset to today.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (date = travelDate) => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await withTimeout(DestinationDiscoveryService.getUnmetDemand({
        userId: user?.id, travelDate: date, origin
      }));
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
  }, [origin, travelDate, user?.id]);

  useEffect(() => { load(travelDate); }, [load, travelDate]);

  return (
    <div className="dsc-page">
      <button className="dsc-back" onClick={() => navigate(readExploreReturn().url)} type="button">
        <IconArrowLeft size={16} /> Back to destinations
      </button>

      <header className="dsc-header">
        <h1>Where travellers need a ride</h1>
        <p>
          See destinations travellers are considering for this date that still
          have no listed ride with an available seat. Drivers can publish a
          ride here.
        </p>
      </header>

      <AudienceSwitch active="demand" travelDate={travelDate} demo={demo} />
      <DemoActiveBanner />

      {demo && (
        <DemoControls
          travelDate={travelDate}
          onTravelDateChange={(date) => setSearchParams((current) => { const next = new URLSearchParams(current); next.set('date', date); return next; })}
          onChanged={() => load()}
        />
      )}

      <div className="dsc-controls">
        <label className="dsc-field">
          <span>Travel date</span>
          <input
            type="date"
            value={travelDate}
            min={todayIso()}
            onChange={(event) => setSearchParams((current) => { const next = new URLSearchParams(current); next.set('date', event.target.value); return next; })}
          />
        </label>
      </div>

      {loading && <p className="dsc-empty">Checking demand…</p>}

      {/* "Nothing needs a driver" is a strong claim to make about a read that
          never returned - it would send a Host away believing the work is done. */}
      {!loading && failed && (
        <div className="dsc-empty dsc-failed" role="alert">
          <p className="dsc-failed-title">We could not check demand.</p>
          <p>The place catalogue did not respond. It may be a connection problem.</p>
          <button type="button" className="dsc-failed-action" onClick={() => load()}>
            Try again
          </button>
        </div>
      )}

      {!loading && !failed && rows.length === 0 && (
        <p className="dsc-empty">
          No open travel demand for this date. A destination appears here after
          travellers mark interest and no listed ride has an available seat.
        </p>
      )}

      {!loading && !failed && rows.length > 0 && (
        <div className="dsc-list">
          {rows.map((row) => (
            <article className="dsc-card dsc-card-unserved" key={row.placeId}>
              <span className="dsc-card-media">
                <PlaceImage place={row.place} widthPx={PHOTO_WIDTH_CARD} />
              </span>

              <span className="dsc-card-body">
                <span className="dsc-card-head">
                  <h3 className="dsc-card-title">{row.place.name}</h3>
                  <span className="dsc-chip">{row.place.category}</span>
                </span>

                <span className="dsc-card-meta">
                  <span className="dsc-meta-item"><IconMapPin size={14} /> {row.place.state}</span>
                  {Number.isFinite(row.distanceKm) && (
                    <span className="dsc-meta-item">{Math.round(row.distanceKm)} km straight line</span>
                  )}
                </span>

                <span className="dsc-availability dsc-unserved">
                  <IconUsers size={16} />
                  <span>
                    <strong>{row.interestedUsers}</strong>{' '}
                    {row.interestedUsers === 1 ? 'person has shown interest' : 'people have shown interest'} for {travelDate}
                  </span>
                </span>

                <span className="dsc-actions">
                  <button
                    className="dsc-btn dsc-btn-primary"
                    type="button"
                    onClick={() => navigate(DestinationDiscoveryService.buildPrefillUrl(
                      'publish', row.place, { origin, travelDate }
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
