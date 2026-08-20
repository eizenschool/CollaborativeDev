import { IconCar, IconCheck } from '../icons.jsx';

export default function RideVehicleSelector({ vehicles, vehicleId, disabled = false, onSelect }) {
  return (
    <div className="vehicle-select-grid">
      {vehicles.map((vehicle) => (
        <button
          type="button"
          key={vehicle.id}
          className={'vehicle-select-card' + (vehicleId === vehicle.id ? ' active' : '')}
          aria-pressed={vehicleId === vehicle.id}
          disabled={disabled}
          onClick={() => onSelect(vehicle)}
        >
          <span className="vehicle-select-icon"><IconCar size={16} /></span>
          <div>
            <div className="vehicle-select-name">{vehicle.make} {vehicle.model}</div>
            <div className="vehicle-select-meta">{vehicle.plate} · {vehicle.seats} seats</div>
          </div>
          {vehicleId === vehicle.id && <span className="vehicle-select-check"><IconCheck size={14} /></span>}
        </button>
      ))}
    </div>
  );
}
