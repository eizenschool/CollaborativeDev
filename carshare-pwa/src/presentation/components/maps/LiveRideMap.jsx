import { useEffect, useRef, useState } from 'react';
import { createMapDiagnostic, loadGoogleMapsLibraries } from '../../../business-logic/GooglePlacesService.js';
import { RideLiveTrackingService } from '../../../business-logic/RideLiveTrackingService.js';

const mapId = import.meta.env.VITE_GOOGLE_MAP_ID?.trim() || '';
const TRACK_COLORS = ['#0F766E', '#2563EB', '#C2410C', '#7C3AED', '#BE123C'];

function centreFor(ride, points) {
  const first = points[0];
  if (first) return { lat: first.lat, lng: first.lng };
  const location = ride?.pickupLocation;
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: 3.139, lng: 101.6869 };
}

function pointKey(point, index) {
  return point?.markerId || point?.userId || `${point?.role || 'participant'}-${index}`;
}

function trackColor(userId, fallbackIndex) {
  const value = String(userId || fallbackIndex);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  return TRACK_COLORS[hash % TRACK_COLORS.length];
}

export default function LiveRideMap({ ride, points = [], segments = [], pageSessionId, mapPermit = false, ariaLabel = 'Live ride location map' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRefs = useRef(new Map());
  const circleRefs = useRef(new Map());
  const polylineRefs = useRef(new Map());
  const [status, setStatus] = useState('loading');
  const [diagnostic, setDiagnostic] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const showFallback = (stage, error = null, fallbackCode = 'MAP_UNAVAILABLE') => {
        if (!active) return;
        const nextDiagnostic = createMapDiagnostic(stage, error, fallbackCode);
        console.warn('[LiveRideMap] Interactive map fallback', nextDiagnostic);
        setDiagnostic(nextDiagnostic);
        setStatus('fallback');
      };
      if (!mapId) { showFallback('configuration', null, 'MAP_ID_MISSING'); return; }
      if (!pageSessionId) { showFallback('configuration', null, 'PAGE_SESSION_MISSING'); return; }
      let stage = 'map-permit';
      try {
        const permitted = mapPermit || await RideLiveTrackingService.consumeDynamicMapLoad(pageSessionId);
        if (!permitted || !active) { showFallback('map-permit', null, 'MAP_LOAD_LIMIT'); return; }
        stage = 'google-libraries';
        const { maps, marker } = await loadGoogleMapsLibraries(['maps', 'marker']);
        if (!active || !containerRef.current) return;
        stage = 'map-construction';
        mapRef.current = new maps.Map(containerRef.current, {
          center: centreFor(ride, points),
          zoom: 14,
          mapId,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false
        });
        mapRef.current.__advancedMarkerClass = marker.AdvancedMarkerElement;
        mapRef.current.__circleClass = maps.Circle;
        mapRef.current.__polylineClass = maps.Polyline;
        mapRef.current.__latLngBoundsClass = maps.LatLngBounds;
        setDiagnostic(null);
        setStatus('ready');
      } catch (error) {
        showFallback(stage, error);
      }
    })();
    return () => {
      active = false;
      markerRefs.current.forEach((item) => { item.map = null; });
      circleRefs.current.forEach((item) => { item.setMap(null); });
      polylineRefs.current.forEach((item) => { item.setMap(null); });
      markerRefs.current.clear();
      circleRefs.current.clear();
      polylineRefs.current.clear();
      mapRef.current = null;
    };
  }, [mapPermit, pageSessionId, ride?.id]);

  useEffect(() => {
    const map = mapRef.current;
    const Marker = map?.__advancedMarkerClass;
    const Circle = map?.__circleClass;
    if (!map || !Marker || !Circle) return;
    const seen = new Set();
    const positions = [];
    points.forEach((point, index) => {
      const id = pointKey(point, index);
      if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return;
      seen.add(id);
      positions.push({ lat: point.lat, lng: point.lng });
      let marker = markerRefs.current.get(id);
      if (!marker) {
        marker = new Marker({ map, title: point.role || 'Participant' });
        markerRefs.current.set(id, marker);
      }
      marker.position = { lat: point.lat, lng: point.lng };
      marker.title = `${point.label || (point.role === 'Driver' ? 'Driver’s current location' : 'Passenger current location')} (±${Math.round(point.accuracyM)} m)`;
      let circle = circleRefs.current.get(id);
      if (!circle) {
        const color = point.role === 'Driver' ? '#2563EB' : '#0F766E';
        circle = new Circle({ map, fillColor: color, fillOpacity: 0.12, strokeColor: color, strokeOpacity: 0.45, strokeWeight: 1 });
        circleRefs.current.set(id, circle);
      }
      circle.setCenter({ lat: point.lat, lng: point.lng });
      circle.setRadius(Math.max(5, point.accuracyM));
    });
    markerRefs.current.forEach((marker, id) => { if (!seen.has(id)) { marker.map = null; markerRefs.current.delete(id); } });
    circleRefs.current.forEach((circle, id) => { if (!seen.has(id)) { circle.setMap(null); circleRefs.current.delete(id); } });
    if (positions.length === 1) {
      if (!map.getBounds()?.contains(positions[0])) map.panTo(positions[0]);
    } else if (positions.length > 1 && map.__latLngBoundsClass) {
      const bounds = new map.__latLngBoundsClass();
      positions.forEach((position) => bounds.extend(position));
      const currentBounds = map.getBounds();
      if (!currentBounds || positions.some((position) => !currentBounds.contains(position))) map.fitBounds(bounds, 48);
    }
  }, [points, status]);

  useEffect(() => {
    const map = mapRef.current;
    const Polyline = map?.__polylineClass;
    if (!map || !Polyline) return;
    polylineRefs.current.forEach((line) => line.setMap(null));
    polylineRefs.current.clear();
    segments.forEach((segment, index) => {
      const path = (segment.points || []).map((point) => ({ lat: point.lat, lng: point.lng }));
      if (path.length < 2) return;
      const line = new Polyline({
        map,
        path,
        geodesic: true,
        strokeColor: trackColor(segment.userId, index),
        strokeOpacity: 0.8,
        strokeWeight: 4
      });
      polylineRefs.current.set(segment.id || `${segment.userId || 'track'}-${index}`, line);
    });
  }, [segments, status]);

  if (status === 'fallback') {
    const limitReached = diagnostic?.code === 'MAP_LOAD_LIMIT';
    return <div className="live-map-fallback" data-map-fallback-stage={diagnostic?.stage || 'unknown'} data-map-fallback-code={diagnostic?.code || 'MAP_UNAVAILABLE'}><span>{limitReached ? 'Interactive map has reached today’s app limit.' : 'Interactive map is temporarily unavailable.'}</span><small>Use the live location cards and Open in Google Maps links below.</small></div>;
  }
  return <div className="live-ride-map" aria-label={ariaLabel}><div className="live-ride-map-canvas" ref={containerRef} />{status === 'loading' && <span className="live-map-loading">Loading live map…</span>}</div>;
}
