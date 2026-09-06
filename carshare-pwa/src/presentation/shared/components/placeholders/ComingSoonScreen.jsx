// ===== PRESENTATION LAYER (ComingSoonScreen) =====
// One shared stub for every nav tab that belongs to a module not yet built in
// this codebase (Home, Search, Ride, Message, Favourite all belong to Modules
// 2-6). Keeps the nav bar's final shape fully clickable and demonstrable
// without faking functionality - see Section 5 of the nav design spec.
export default function ComingSoonScreen({ icon: Icon, label }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-icon">
        <Icon size={40} />
      </div>
      <p className="coming-soon-title">{label}</p>
      <p className="coming-soon-text">Coming soon — {label} isn't available in this prototype yet.</p>
    </div>
  );
}
