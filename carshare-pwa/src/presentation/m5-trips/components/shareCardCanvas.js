// ===== PRESENTATION LAYER (share card drawing) =====
// Pure canvas work for the monthly impact card. Kept out of the dialog so the
// component stays about interaction, and out of business-logic because it
// needs a DOM canvas.
//
// The card is drawn for whatever size TripShareCard's formats ask for, so the
// vertical positions cannot be constants. Sections carry their own height and
// the leftover space is shared between them, capped so a tall Story does not
// simply stretch the gaps - the block stays together and centres instead.

const MARGIN_Y = 76;
const MAX_GAP = 92;
const MIN_GAP = 14;

// Height each section occupies, top to bottom. Text is drawn on the section's
// middle line, so a section only needs to be tall enough for its type.
const SECTIONS = [
  { id: 'label', h: 44 },
  { id: 'month', h: 78 },
  { id: 'headline', h: 206 },
  { id: 'unit', h: 62 },
  { id: 'panel', h: 360 },
  { id: 'footnote', h: 54 },
  { id: 'byline', h: 46 }
];

// Relative appetite for the spare space between sections. The headline and its
// unit belong together, so the gap between them barely grows.
const GAP_WEIGHTS = [0.5, 1.1, 0.15, 1.3, 1.2, 0.9];

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function layout(height) {
  const content = SECTIONS.reduce((sum, section) => sum + section.h, 0);
  const weight = GAP_WEIGHTS.reduce((sum, value) => sum + value, 0);
  const spare = Math.max(0, height - MARGIN_Y * 2 - content);

  const gaps = GAP_WEIGHTS.map((value) =>
    Math.max(MIN_GAP, Math.min(MAX_GAP, (spare * value) / weight))
  );

  const used = content + gaps.reduce((sum, gap) => sum + gap, 0);
  // Whatever the caps left over becomes equal top and bottom margin, so a tall
  // card centres its block rather than drifting to the top.
  let cursor = Math.max(MARGIN_Y, (height - used) / 2);

  const positions = {};
  SECTIONS.forEach((section, index) => {
    positions[section.id] = { top: cursor, height: section.h, middle: cursor + section.h / 2 };
    cursor += section.h + (gaps[index] || 0);
  });
  return positions;
}

export function drawShareCard(canvas, content, theme, format) {
  const { width, height } = format;
  const ctx = canvas.getContext('2d');
  canvas.width = width;
  canvas.height = height;

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, theme.from);
  bg.addColorStop(1, theme.to);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Same decorative circles as the module's banner, scaled with the canvas so
  // they read the same on every format.
  const orb = Math.min(width, height) * 0.24;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.arc(width - 60, height * 0.09, orb, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.arc(120, height - height * 0.07, orb * 0.78, 0, Math.PI * 2); ctx.fill();

  const at = layout(height);
  const centre = width / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 34px Inter, system-ui, sans-serif';
  ctx.fillText('MY ECO IMPACT', centre, at.label.middle);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 62px Poppins, system-ui, sans-serif';
  ctx.fillText(content.monthLabel, centre, at.month.middle);

  ctx.font = '700 200px Poppins, system-ui, sans-serif';
  ctx.fillText(content.headline, centre, at.headline.middle);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '600 48px Inter, system-ui, sans-serif';
  ctx.fillText(content.headlineUnit, centre, at.unit.middle);

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundedRect(ctx, 80, at.panel.top, width - 160, at.panel.height, 40);
  ctx.fill();

  const rowGap = at.panel.height / (content.stats.length + 1);
  content.stats.forEach((item, index) => {
    const y = at.panel.top + rowGap * (index + 1);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 58px Poppins, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(item.value, centre - 24, y);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '400 38px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, centre + 24, y);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '500 40px Inter, system-ui, sans-serif';
  ctx.fillText(content.footnote, centre, at.footnote.middle);

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 36px Inter, system-ui, sans-serif';
  ctx.fillText(content.byline, centre, at.byline.middle);
}

export function canvasToPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The card could not be rendered.'))),
      'image/png'
    );
  });
}
