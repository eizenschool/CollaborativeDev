import {
  IconCalendar,
  IconClock,
  IconMapPin,
  IconSearch
} from '../icons.jsx';
import { applyManualDestinationText } from '../../../business-logic/SmartSearchService.js';

export default function SearchForm({ criteria, onChange, onSubmit, loading }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  const patch = (values) => onChange({ ...criteria, ...values });

  return (
    <form className="smart-search-form" onSubmit={onSubmit} aria-label="Search available rides">
      <label className="smart-field smart-field-route" htmlFor="smart-search-pickup">
        <span>Pickup</span>
        <span className="smart-input-wrap">
          <IconMapPin size={16} aria-hidden="true" />
          <input
            id="smart-search-pickup"
            autoComplete="street-address"
            value={criteria.pickup}
            onChange={(event) => patch({ pickup: event.target.value })}
            placeholder="e.g. KL Sentral"
          />
        </span>
      </label>

      <label className="smart-field smart-field-route" htmlFor="smart-search-destination">
        <span>Destination</span>
        <span className="smart-input-wrap destination">
          <IconMapPin size={16} aria-hidden="true" />
          <input
            id="smart-search-destination"
            autoComplete="street-address"
            value={criteria.destination}
            onChange={(event) => onChange(applyManualDestinationText(criteria, event.target.value))}
            placeholder="e.g. Georgetown"
          />
        </span>
      </label>

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
