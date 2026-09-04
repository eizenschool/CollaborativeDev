// ===== PRESENTATION LAYER (DiscoverRoutes) =====
// Module 6's own sub-router, mounted once at /discover/* in App.jsx so adding a
// screen here never touches the shared route table again.
//
// The index route used to render the full discovery hub; that content now
// lives at /home (see docs/ai/DECISIONS.md), so it redirects there instead -
// preserving the query string, since /discover?date=... links (notifications,
// shared links) still need to land on the right travel date.
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import DestinationDetail from './DestinationDetail.jsx';
import UnmetDemandView from './UnmetDemandView.jsx';
import '../../styles/discover.css';

function RedirectToHome() {
  const location = useLocation();
  return <Navigate to={`/home${location.search}`} replace />;
}

export default function DiscoverRoutes() {
  return (
    <Routes>
      <Route index element={<RedirectToHome />} />
      {/* Declared before ":placeId" so "demand" is read as this screen rather
          than as a destination whose id happens to be "demand". */}
      <Route path="demand" element={<UnmetDemandView />} />
      <Route path=":placeId" element={<DestinationDetail />} />
    </Routes>
  );
}
