import { IconCalendar, IconClock, IconSearch } from '../icons.jsx';
import { applyManualDestinationText } from '../../../business-logic/SmartSearchService.js';
import ConfirmedLocationInput from '../maps/ConfirmedLocationInput.jsx';

export default function SearchForm({ criteria, onChange, onSubmit, loading }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  const patch = (values) => onChange({ ...criteria, ...values });

  return (
    <form className="smart-search-form" onSubmit={onSubmit} aria-label="Search available rides">
      <div className="smart-field smart-field-route search-location-field">
        <ConfirmedLocationInput
          id="smart-search-pickup"
          label="Pickup"
          placeholder="Search a place in Malaysia"
          value={criteria.pickup}
          location={criteria.pickupPlaceId ? { source: 'place', placeId: criteria.pickupPlaceId } : null}
          searchOnFocusOnly
          onChange={(pickup, location) => patch({
            pickup,
            pickupPlaceId: location?.placeId || ''
          })}
        />
      </div>

      <div className="smart-field smart-field-route search-location-field destination">
        <ConfirmedLocationInput
          id="smart-search-destination"
          label="Destination"
          placeholder="Search a place in Malaysia"
          value={criteria.destination}
          location={criteria.destinationSearchPlaceId
            ? { source: 'place', placeId: criteria.destinationSearchPlaceId }
            : (criteria.destinationPlaceId ? { source: 'place', placeId: criteria.destinationPlaceId } : null)}
          searchOnFocusOnly
          onChange={(destination, location) => onChange(applyManualDestinationText(
            criteria,
            destination,
            location?.placeId || ''
          ))}
        />
      </div>

      <label className="smart-field" htmlFor="smart-search-date">
        <span>Travel date</span>
        <span className="smart-input-wrap">
          <IconCalendar size={16} aria-hidden="true" />
          <input
            id="smart-search-date"
            type="date"
            min={today}
            value={criteria.date}
            onChange={(event) => patch({ date: event.target.value })}
          />
        </span>
      </label>

      <label className="smart-field" htmlFor="smart-search-time">
        <span>Depart after</span>
        <span className="smart-input-wrap">
          <IconClock size={16} aria-hidden="true" />
          <input
            id="smart-search-time"
            type="time"
            value={criteria.departAfter}
            onChange={(event) => patch({ departAfter: event.target.value })}
          />
        </span>
      </label>

      <button className="smart-search-submit" type="submit" disabled={loading}>
        <IconSearch size={18} aria-hidden="true" />
        {loading ? 'Searching…' : 'Search rides'}
      </button>
    </form>
  );
}
