// ===== PRESENTATION LAYER (photo load-state cache) =====
// Whether a given place-photo URL has already proven it loads, or has
// exhausted PlaceImage's one retry and failed, for the life of this tab.
// Mirrors the Map-cache pattern StreetView.js's coverageCache uses for
// StreetViewFrame - the sibling frame in the same DestinationDetail.jsx
// Carousel, which shares the same "only the active slide stays mounted, so
// swiping away and back is a real remount" architecture.
//
// This is deliberately not business logic and does not belong in
// placePhotos.js: no network fetch happens here (the browser's own <img> tag
// performs the request), and placePhotos.js's header explicitly documents
// that it caches nothing about the URL or the image bytes. What this caches
// is a different fact entirely - whether that DOM element's load already
// succeeded or failed once in this tab - so a remounted PlaceImage does not
// have to re-litigate it from a blank slate every time the user swipes back.
const photoStatusCache = new Map(); // url -> 'loaded' | 'failed'

export function getCachedPhotoStatus(url) {
  return url ? photoStatusCache.get(url) : undefined;
}

export function setCachedPhotoStatus(url, status) {
  if (url) photoStatusCache.set(url, status);
}

/** Test hook, so one case's cached status cannot leak into the next. */
export function __clearPhotoStatusCache() {
  photoStatusCache.clear();
}
