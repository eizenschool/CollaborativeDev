// ===== PRESENTATION LAYER (DiscoverRoutes) =====
// Module 6's own sub-router, mounted once at /discover/* in App.jsx so adding a
// screen here never touches the shared route table again.
import { Route, Routes } from 'react-router-dom';
import DiscoverHub from './DiscoverHub.jsx';
import DestinationDetail from './DestinationDetail.jsx';
import UnmetDemandView from './UnmetDemandView.jsx';
import '../../styles/discover.css';

export default function DiscoverRoutes() {
  return (
    <Routes>
      <Route index element={<DiscoverHub />} />
      {/* Declared before ":placeId" so "demand" is read as this screen rather
          than as a destination whose id happens to be "demand". */}
      <Route path="demand" element={<UnmetDemandView />} />
      <Route path=":placeId" element={<DestinationDetail />} />
    </Routes>
  );
}
