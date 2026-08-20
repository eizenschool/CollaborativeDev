// ===== PRESENTATION LAYER (ShareReportDialog) =====
// Module 5 - the export panel for the monthly impact card: pick a palette,
// see it redraw, then choose how it leaves the app.
//
// What each action can honestly do:
//   - Share to apps  -> the device share sheet, the ONLY route that carries
//     the image itself to Instagram, Messenger, Facebook and the rest. Mobile
//     browsers only, so it is hidden where navigator.canShare is absent.
//   - Copy image     -> clipboard, so the card can be pasted into any chat.
//   - Download / Copy text -> always available.
//   - WhatsApp / Telegram / X -> a URL can only carry TEXT. They are labelled
//     accordingly and copy the image first so it can be pasted alongside.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CARD_THEMES,
  DEFAULT_THEME_ID,
  buildTextShareTargets,
  themeById
} from '../../../business-logic/TripShareCard.js';
import { canvasToPng, drawShareCard } from './shareCardCanvas.js';

function useObjectUrl() {
  const previous = useRef(null);
  useEffect(() => () => { if (previous.current) URL.revokeObjectURL(previous.current); }, []);
  return useCallback((blob) => {
    if (previous.current) URL.revokeObjectURL(previous.current);
    previous.current = URL.createObjectURL(blob);
    return previous.current;
  }, []);
}

export default function ShareReportDialog({ content, onClose }) {
  const canvasRef = useRef(null);
  const closeRef = useRef(null);
  const trackUrl = useObjectUrl();

  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [preview, setPreview] = useState(null);
  const [blob, setBlob] = useState(null);
  const [note, setNote] = useState('');

  const canUseShareSheet =
    typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  // Redraw whenever the palette changes. Webfonts must be ready first or the
  // canvas silently falls back to a system face.
  useEffect(() => {
    let active = true;
    (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      if (!active || !canvasRef.current) return;
      drawShareCard(canvasRef.current, content, themeById(themeId));
      const png = await canvasToPng(canvasRef.current);
      if (!active) return;
      setBlob(png);
      setPreview(trackUrl(png));
    })().catch(() => {
      if (active) setNote('The card could not be drawn.');
    });
    return () => { active = false; };
  }, [content, themeId, trackUrl]);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copyImage() {
    if (!blob) return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  }

  async function handleShareSheet() {
    try {
      const file = new File([blob], content.filename, { type: 'image/png' });
      if (!navigator.canShare?.({ files: [file] })) {
        setNote('This browser cannot share files. Download or copy the image instead.');
        return;
      }
      await navigator.share({ files: [file], title: content.shareTitle, text: content.shareText });
      setNote('Shared.');
    } catch (error) {
      // Dismissing the sheet is a choice, not a failure.
      if (error?.name !== 'AbortError') setNote('Sharing was not completed.');
    }
  }

  function handleDownload() {
    const link = document.createElement('a');
    link.href = preview;
    link.download = content.filename;
    link.click();
    setNote(`Saved as ${content.filename}`);
  }

  async function handleCopyImage() {
    const ok = await copyImage();
    setNote(ok ? 'Image copied - paste it into any chat.' : 'This browser blocked the copy. Download instead.');
  }

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(content.shareText);
      setNote('Text copied.');
    } catch {
      setNote('This browser blocked the copy.');
    }
  }

  async function handleTextTarget(target) {
    // Copy first so the image can be pasted next to the text that opens.
    const copied = await copyImage();
    window.open(target.href, '_blank', 'noopener,noreferrer');
    setNote(copied
      ? `${target.label} opened with your text - paste the copied image there too.`
      : `${target.label} opened with your text. Download the image to attach it.`);
  }

  return (
    <div
      className="m5-share-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="m5-share-dialog" role="dialog" aria-modal="true" aria-label="Share your monthly impact">
        <div className="m5-share-head">
          <h3>Share your impact</h3>
          <button ref={closeRef} className="m5-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="m5-share-body">
          <div className="m5-share-preview">
            {preview
              ? <img src={preview} alt={`Impact card for ${content.monthLabel}`} />
              : <div className="m5-share-skeleton" />}
          </div>

          <div className="m5-share-controls">
            <p className="m5-share-label" id="m5-theme-label">Colour</p>
            <div className="m5-swatches" role="radiogroup" aria-labelledby="m5-theme-label">
              {CARD_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  role="radio"
                  aria-checked={themeId === theme.id}
                  aria-label={theme.name}
                  title={theme.name}
                  className={'m5-swatch' + (themeId === theme.id ? ' active' : '')}
                  style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}
                  onClick={() => setThemeId(theme.id)}
                />
              ))}
            </div>

            {canUseShareSheet && (
              <button className="m5-share-primary" onClick={handleShareSheet} disabled={!blob}>
                <span aria-hidden="true">📤</span> Share to apps
              </button>
            )}

            <p className="m5-share-label">Send as text</p>
            <div className="m5-share-targets">
              {buildTextShareTargets(content).map((target) => (
                <button
                  key={target.id}
                  className="m5-share-target"
                  onClick={() => handleTextTarget(target)}
                  disabled={!blob}
                >
                  <span className="m5-share-target-dot" style={{ background: target.brand }} aria-hidden="true" />
                  {target.label}
                </button>
              ))}
            </div>

            <p className="m5-share-label">Save or copy</p>
            <div className="m5-share-actions">
              <button className="m5-chip" onClick={handleDownload} disabled={!blob}>⬇ PNG</button>
              <button className="m5-chip" onClick={handleCopyImage} disabled={!blob}>🖼 Copy image</button>
              <button className="m5-chip" onClick={handleCopyText}>🔗 Copy text</button>
            </div>

            {!canUseShareSheet && (
              <p className="m5-share-hint">
                Instagram, Messenger and Facebook can only receive the picture through your
                phone&apos;s share sheet. Open this page on your phone, or copy the image and
                paste it there.
              </p>
            )}

            <p className="m5-share-note" role="status">{note}</p>
          </div>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
      </div>
    </div>
  );
}
