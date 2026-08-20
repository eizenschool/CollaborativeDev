// ===== PRESENTATION LAYER (share card drawing) =====
// Pure canvas work for the monthly impact card. Kept out of the dialog so the
// component stays about interaction, and out of business-logic because it
// needs a DOM canvas.

export const CARD_W = 1080;
export const CARD_H = 1350;

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawShareCard(canvas, content, theme) {
  const ctx = canvas.getContext('2d');
  canvas.width = CARD_W;
  canvas.height = CARD_H;

  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, theme.from);
  bg.addColorStop(1, theme.to);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Same decorative circles as the module's banner, so the card is
  // recognisably from this app whichever palette it wears.
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.arc(CARD_W - 60, 120, 260, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.arc(120, CARD_H - 90, 200, 0, Math.PI * 2); ctx.fill();

  ctx.textAlign = 'center';

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 34px Inter, system-ui, sans-serif';
  ctx.fillText('MY ECO IMPACT', CARD_W / 2, 150);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 62px Poppins, system-ui, sans-serif';
  ctx.fillText(content.monthLabel, CARD_W / 2, 232);

  ctx.font = '700 210px Poppins, system-ui, sans-serif';
  ctx.fillText(content.headline, CARD_W / 2, 470);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '600 48px Inter, system-ui, sans-serif';
  ctx.fillText(content.headlineUnit, CARD_W / 2, 540);

  const panelY = 640;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundedRect(ctx, 80, panelY, CARD_W - 160, 360, 40);
  ctx.fill();

  content.stats.forEach((item, index) => {
    const y = panelY + 110 + index * 105;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 58px Poppins, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(item.value, CARD_W / 2 - 24, y);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '400 38px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, CARD_W / 2 + 24, y);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '500 40px Inter, system-ui, sans-serif';
  ctx.fillText(content.footnote, CARD_W / 2, 1110);

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 36px Inter, system-ui, sans-serif';
  ctx.fillText(content.byline, CARD_W / 2, 1250);
}

export function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The card could not be rendered.'))),
      'image/png'
    );
  });
}
