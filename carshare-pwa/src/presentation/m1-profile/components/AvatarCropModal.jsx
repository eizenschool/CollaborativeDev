// ===== PRESENTATION LAYER (AvatarCropModal) =====
// Drag-to-pan, slider-to-zoom crop step shown before a profile photo
// upload. Runs entirely client-side against a temporary object URL -
// nothing here touches ProfileService or any backend; it only turns the
// picked File into a better-framed one before the existing pipeline
// (ProfileService.updateProfilePhoto - size/type checks, the Gemini content
// check, then the upload) ever sees it.
//
// Built on the shared AdaptiveDialog rather than a hand-rolled
// position:fixed overlay (an earlier version of this file used one, and it
// needed the page scrolled to actually reach the buttons - AdaptiveDialog
// portals to document.body specifically to dodge that: a `position: fixed`
// descendant is clipped to the nearest ancestor with a transform/filter/
// backdrop-filter instead of the real viewport, so a dialog rendered deep
// in the component tree can silently end up positioned relative to some
// unrelated ancestor rather than the screen. AdaptiveDialog also turns into
// a bottom sheet on small screens for free, which a bespoke overlay did not.
//
// Exports a square photo, not a circular one. The existing CSS already
// circle-clips every avatar display (.big-avatar, .avatar-dot, the nav
// bar), so baking a circular alpha mask into the file itself would make the
// same photo look wrong anywhere it's ever shown as a square instead (e.g.
// a future admin table row). The circular guide here is only a preview of
// that existing clip, not something written into the exported file.
import { useEffect, useMemo, useRef, useState } from 'react';
import AdaptiveDialog from '../../shared/components/ui/AdaptiveDialog.jsx';
import { Button } from '../../shared/components/ui/Button.jsx';

const OUTPUT_SIZE = 512;
const MAX_CONTAINER_SIZE = 260;
const MIN_CONTAINER_SIZE = 160;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function computeContainerSize() {
  if (typeof window === 'undefined') return MAX_CONTAINER_SIZE;
  // AdaptiveDialog's own header/footer/padding take up space above and
  // below the body; this leaves room for that so the circle itself is
  // rarely what forces the dialog body to scroll.
  return Math.round(Math.max(
    MIN_CONTAINER_SIZE,
    Math.min(MAX_CONTAINER_SIZE, window.innerWidth - 96, window.innerHeight - 320)
  ));
}

export default function AvatarCropModal({ file, imageUrl, onCancel, onConfirm }) {
  const [containerSize, setContainerSize] = useState(computeContainerSize);
  const [naturalSize, setNaturalSize] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragStart = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    function onResize() { setContainerSize(computeContainerSize()); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The zoom=1 scale that makes the image exactly cover the square
  // container (CSS object-fit: cover, computed by hand since the pan
  // transform below needs the same numbers to stay in sync).
  const baseScale = useMemo(() => {
    if (!naturalSize) return 1;
    return Math.max(containerSize / naturalSize.width, containerSize / naturalSize.height);
  }, [naturalSize, containerSize]);

  function clampOffset(next, currentZoom) {
    if (!naturalSize) return next;
    const displayWidth = naturalSize.width * baseScale * currentZoom;
    const displayHeight = naturalSize.height * baseScale * currentZoom;
    const maxX = Math.max(0, (displayWidth - containerSize) / 2);
    const maxY = Math.max(0, (displayHeight - containerSize) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y))
    };
  }

  function handleImgLoad(e) {
    setNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight });
  }

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, offset };
  }

  function handlePointerMove(e) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffset(clampOffset({ x: dragStart.current.offset.x + dx, y: dragStart.current.offset.y + dy }, zoom));
  }

  function handlePointerUp() {
    dragStart.current = null;
    setDragging(false);
  }

  function handleZoomChange(e) {
    const next = Number(e.target.value);
    setZoom(next);
    setOffset((prev) => clampOffset(prev, next));
  }

  async function handleConfirm() {
    if (!naturalSize) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      // Same transform as the on-screen preview, just scaled up to the
      // higher-resolution output size - what you see while dragging is
      // exactly what gets uploaded.
      const exportScale = OUTPUT_SIZE / containerSize;
      const displayWidth = naturalSize.width * baseScale * zoom;
      const displayHeight = naturalSize.height * baseScale * zoom;
      const drawX = (containerSize / 2 + offset.x - displayWidth / 2) * exportScale;
      const drawY = (containerSize / 2 + offset.y - displayHeight / 2) * exportScale;
      ctx.drawImage(imgRef.current, drawX, drawY, displayWidth * exportScale, displayHeight * exportScale);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      const baseName = (file.name || 'avatar').replace(/\.\w+$/, '');
      onConfirm(new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdaptiveDialog
      open
      onClose={() => { if (!busy) onCancel(); }}
      title="Adjust your photo"
      description="Drag to reposition, use the slider to zoom"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={handleConfirm} loading={busy} loadingLabel="Processing" disabled={!naturalSize}>
            Use this photo
          </Button>
        </>
      )}
    >
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            width: containerSize, height: containerSize, margin: '4px 0 16px',
            borderRadius: '50%', overflow: 'hidden', position: 'relative',
            background: '#eee', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none'
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            draggable={false}
            onLoad={handleImgLoad}
            style={naturalSize ? {
              position: 'absolute', left: '50%', top: '50%',
              width: naturalSize.width * baseScale,
              height: naturalSize.height * baseScale,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
              transformOrigin: 'center'
            } : { width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      </div>
      <input
        type="range" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={zoom}
        onChange={handleZoomChange} style={{ width: '100%' }} aria-label="Zoom"
        disabled={!naturalSize}
      />
    </AdaptiveDialog>
  );
}
