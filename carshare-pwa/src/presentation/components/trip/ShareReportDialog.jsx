// ===== PRESENTATION LAYER (ShareReportDialog) =====
// Module 5 - the export panel for the monthly impact card: pick a palette,
// see it redraw, then choose how it leaves the app.
//
// TWO WAYS OUT, BECAUSE NEITHER ONE CAN DO BOTH JOBS.
//
//   - Share to apps       -> navigator.share({files}) hands the PNG itself to
//     whichever app is chosen, so nothing has to be pasted. The catch is that
//     the Web Share API has no way to name a target: it always opens the OS
//     picker, and the app is chosen there. Hidden where canShare is absent.
//
//   - WhatsApp/Telegram/X -> open that one app directly, which is the whole
//     point of a branded button. A URL can only carry text (wa.me, t.me and
//     x.com take a text parameter and nothing else), so the card goes to the
//     clipboard on the way out and the handoff banner says to paste it.
//
// Asking one button to do both is what made this confusing before: routing the
// branded buttons through the share sheet meant "WhatsApp" opened a list of
// forty apps instead of WhatsApp.
//
//   - Copy image / Save PNG / Copy caption -> the manual pieces.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CARD_FORMATS,
  CARD_THEMES,
  DEFAULT_FORMAT_ID,
  DEFAULT_THEME_ID,
  buildTextShareTargets,
  filenameFor,
  formatById,
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
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const trackUrl = useObjectUrl();
  onCloseRef.current = onClose;

  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [formatId, setFormatId] = useState(DEFAULT_FORMAT_ID);
  const [preview, setPreview] = useState(null);
  const [blob, setBlob] = useState(null);
  const [note, setNote] = useState('');
  // When a chat app has to be handed the card through the clipboard, saying so
  // in the 12px status line at the bottom of a tall panel is the same as not
  // saying it: people press the button, see text arrive in WhatsApp and
  // conclude the picture was lost. This is that message, where it cannot be
  // missed.
  const [handoff, setHandoff] = useState(null);

  const canUseShareSheet =
    typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  const pasteKey = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform || '')
    ? '\u2318V'
    : 'Ctrl + V';

  // Redraw whenever the palette changes. Webfonts must be ready first or the
  // canvas silently falls back to a system face.
  useEffect(() => {
    let active = true;
    (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      if (!active || !canvasRef.current) return;
      drawShareCard(canvasRef.current, content, themeById(themeId), formatById(formatId));
      const png = await canvasToPng(canvasRef.current);
      if (!active) return;
      setBlob(png);
      setPreview(trackUrl(png));
    })().catch(() => {
      if (active) setNote('The card could not be drawn.');
    });
    return () => { active = false; };
  }, [content, themeId, formatId, trackUrl]);

  // A redrawn card is not the one sitting on the clipboard, so the standing
  // instruction to paste it would be wrong.
  useEffect(() => { setHandoff(null); }, [themeId, formatId]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    closeRef.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), a[href]') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      returnFocusRef.current?.focus?.();
    };
  }, []);

  async function copyImage() {
    if (!blob) return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  }

  function pngFile() {
    return new File([blob], filenameFor(content, formatId), { type: 'image/png' });
  }

  function canShareTheFile() {
    return Boolean(blob) && Boolean(navigator.canShare?.({ files: [pngFile()] }));
  }

  async function handleShareSheet() {
    try {
      if (!canShareTheFile()) {
        setNote('This browser cannot share files. Download or copy the image instead.');
        return;
      }
      await navigator.share({ files: [pngFile()], title: content.shareTitle, text: content.shareText });
      setNote('Shared.');
    } catch (error) {
      // Dismissing the sheet is a choice, not a failure.
      if (error?.name !== 'AbortError') setNote('Sharing was not completed.');
    }
  }

  async function handleAppTarget(target) {
    // Straight to the app the button names - no picker in between. The URL
    // carries the caption; the picture rides the clipboard, because there is
    // no third option. Copy BEFORE opening: window.open moves focus, and a
    // clipboard write from an unfocused document is rejected.
    const copied = await copyImage();
    window.open(target.href, '_blank', 'noopener,noreferrer');
    setNote('');
    setHandoff({ label: target.label, copied });
  }

  function handleDownload() {
    const link = document.createElement('a');
    link.href = preview;
    const name = filenameFor(content, formatId);
    link.download = name;
    link.click();
    setNote(`Saved as ${name}`);
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

  return (
    <div
      className="m5-share-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="m5-share-dialog" role="dialog" aria-modal="true" aria-label="Share your monthly impact">
        <div className="m5-share-head">
          <h3>Share your impact</h3>
          <button ref={closeRef} className="m5-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {handoff && (
          <div className={'m5-share-handoff' + (handoff.copied ? '' : ' warn')} role="status">
            <span className="m5-share-handoff-icon" aria-hidden="true">{handoff.copied ? '\u{1F5BC}' : '\u{2B07}'}</span>
            {handoff.copied ? (
              <p>
                <strong>Your card is copied.</strong>
                {` ${handoff.label} is open in another tab - click the message box there and press `}
                <kbd>{pasteKey}</kbd>
                {' to send the picture.'}
              </p>
            ) : (
              <p>
                <strong>{`${handoff.label} is open, but this browser blocked the copy.`}</strong>
                {' Use Save PNG below, then attach the file there.'}
              </p>
            )}
            <button className="m5-icon-btn" onClick={() => setHandoff(null)} aria-label="Dismiss">✕</button>
          </div>
        )}

        <div className="m5-share-body">
          <div className="m5-share-preview">
            {preview
              ? <img src={preview} alt={`Impact card for ${content.monthLabel}`} />
              : <div className="m5-share-skeleton" />}
          </div>

          <div className="m5-share-controls">
            <p className="m5-share-label" id="m5-format-label">Size</p>
            <div className="m5-share-formats" role="radiogroup" aria-labelledby="m5-format-label">
              {CARD_FORMATS.map((format) => (
                <button
                  key={format.id}
                  role="radio"
                  aria-checked={formatId === format.id}
                  className={'m5-format' + (formatId === format.id ? ' active' : '')}
                  onClick={() => setFormatId(format.id)}
                >
                  <span
                    className="m5-format-shape"
                    style={{ aspectRatio: `${format.width} / ${format.height}` }}
                    aria-hidden="true"
                  />
                  <span className="m5-format-name">{format.name}</span>
                  <span className="m5-format-hint">{format.hint}</span>
                </button>
              ))}
            </div>

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

            <p className="m5-share-label">Send to</p>
            <div className="m5-share-targets">
              {buildTextShareTargets(content).map((target) => (
                <button
                  key={target.id}
                  className="m5-share-target"
                  onClick={() => handleAppTarget(target)}
                  disabled={!blob}
                >
                  <span className="m5-share-target-dot" style={{ background: target.brand }} aria-hidden="true" />
                  {target.label}
                </button>
              ))}
            </div>

            <p className="m5-share-label">Save or copy</p>
            <div className="m5-share-actions">
              <button className="m5-chip" onClick={handleCopyImage} disabled={!blob}>🖼 Copy image</button>
              <button className="m5-chip" onClick={handleDownload} disabled={!blob}>⬇ Save PNG</button>
              <button className="m5-chip" onClick={handleCopyText}>✍ Copy caption</button>
            </div>

            <p className="m5-share-note" role="status">{note}</p>
          </div>
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
      </div>
    </div>
  );
}
