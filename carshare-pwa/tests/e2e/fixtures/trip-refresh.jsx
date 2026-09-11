import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RideDetail from '../../../src/presentation/m2-rides/components/ride/RideDetail.jsx';
import RideHub from '../../../src/presentation/m2-rides/components/ride/RideHub.jsx';
import { RideService } from '../../../src/business-logic/m2-rides/RideService.js';
import { RideRequestService } from '../../../src/business-logic/m2-rides/RideRequestService.js';
import { RideReviewService } from '../../../src/business-logic/m2-rides/RideReviewService.js';
import { RideLiveTrackingService } from '../../../src/business-logic/m2-rides/RideLiveTrackingService.js';
import '../../../src/presentation/shared/styles/theme.css';

// Isolated fixture: no real account, GPS watcher, location uploads or backend.
window.tripRefresh = { reads: 0, completedReads: 0, starts: 0, stops: 0 };
const ride = { id: 'refresh-ride', hostId: 'driver', hostName: 'Test Driver',
  pickup: 'Test pickup', destination: 'Test destination', status: 'Matched',
  departureAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  estimatedArrivalAt: new Date(Date.now() + 40 * 60_000).toISOString(),
  seatsAvailable: 2, hasAcceptedRequests: true, waypoints: [], restrictions: [] };
const requests = [{ id: 'accepted', rideId: ride.id, userId: 'passenger', status: 'Accepted', boardingStatus: 'Pending', seatsRequested: 1, ride }];
RideService.getRide = async () => {
  window.tripRefresh.reads++;
  await new Promise((resolve) => setTimeout(resolve, 120));
  window.tripRefresh.completedReads++;
  return { ...ride };
};
RideService.listMyRides = async () => { await RideService.getRide(); return { hosting: [ride] }; };
RideService.getLifecycleContext = async () => ({});
RideRequestService.listRideRequests = async () => requests;
RideRequestService.listMyRequests = async () => [];
RideReviewService.listProfileReviews = async () => [];
RideLiveTrackingService.observeLive = async () => () => {};
RideLiveTrackingService.createWatcher = ({ onState }) => ({
  start: async () => { window.tripRefresh.starts++; onState('live'); },
  stop: async () => { window.tripRefresh.stops++; },
});
const entry = location.search.includes('hub') ? '/ride' : '/ride/refresh-ride?view=trip';
createRoot(document.getElementById('root')).render(<StrictMode><MemoryRouter initialEntries={[entry]}>
  <Routes><Route path="/ride" element={<RideHub />} /><Route path="/ride/:rideId" element={<RideDetail />} /></Routes>
</MemoryRouter></StrictMode>);
