// PDF checklist export: every card of a type, one section per category
// (main / secret lair / tokens), split by rarity inside each, with a ticked
// box for the ones you own. buildChecklistModel is pure (and tested);
// renderChecklistPdf just draws the model.

const PDFDocument = require('pdfkit');
const { RARITY_ORDER } = require('./artDedupe');

const CATEGORY_LABELS = { main: 'Main', secretlair: 'Secret Lair', tokens: 'Tokens' };

const RARITY_LABELS = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic' };

const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Collector numbers can carry letters ("123a"); order by the leading digits
const collectorNumber = (card) => parseInt(card.collector_number, 10) || 0;

// Oldest release first, with collector number (ascending) ordering cards
// released the same day, and name as the final tiebreak so the order is
// stable.
const byRelease = (a, b) =>
  (a.released_at || '').localeCompare(b.released_at || '') ||
  collectorNumber(a) - collectorNumber(b) ||
  a.name.localeCompare(b.name);

// categories: [{ id, cards }] where each card already has `.owned`.
// Tokens are all "common", so rarity headings there would be noise -- they
// get a single unlabeled group.
function buildChecklistModel({ type, categories, upcoming, generatedAt }) {
  const sections = categories.map(({ id, cards }) => {
    const items = (list) =>
      list.sort(byRelease).map((card) => ({
        name: card.name,
        set: card.set,
        number: card.collector_number,
        releasedAt: card.released_at,
        owned: card.owned,
        upcoming: Boolean(card.upcoming),
      }));

    let groups;
    if (id === 'tokens') {
      groups = cards.length ? [{ rarity: null, label: null, cards: cards.slice() }] : [];
    } else {
      const rarities = [...new Set(cards.map((card) => card.rarity))].sort(
        (a, b) => (RARITY_ORDER[a] ?? 99) - (RARITY_ORDER[b] ?? 99)
      );
      groups = rarities.map((rarity) => ({
        rarity,
        label: RARITY_LABELS[rarity] || titleCase(rarity),
        cards: cards.filter((card) => card.rarity === rarity),
      }));
    }

    groups = groups.map((group) => ({
      rarity: group.rarity,
      label: group.label,
      total: group.cards.length,
      owned: group.cards.filter((card) => card.owned > 0).length,
      items: items(group.cards),
    }));

    return {
      id,
      label: CATEGORY_LABELS[id] || titleCase(id),
      total: cards.length,
      owned: cards.filter((card) => card.owned > 0).length,
      groups,
    };
  });

  const total = sections.reduce((sum, section) => sum + section.total, 0);
  const owned = sections.reduce((sum, section) => sum + section.owned, 0);

  return {
    title: `${titleCase(type)} checklist`,
    generatedAt,
    upcoming: Boolean(upcoming),
    total,
    owned,
    sections,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────

const MARGIN = 40;
const GUTTER = 22;
const ROW_H = 13.5;
const BOTTOM = 842 - 50; // A4 height minus footer room
const BOX = 8;

const percent = (owned, total) => (total > 0 ? Math.round((owned / total) * 100) : 0);

function renderChecklistPdf(model, out) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: model.title } });
  doc.pipe(out);

  const pageW = doc.page.width;
  const colW = (pageW - MARGIN * 2 - GUTTER) / 2;
  const colX = (col) => MARGIN + col * (colW + GUTTER);

  let col = 0;
  let y = MARGIN;
  let colTop = MARGIN; // where a column starts on the current page
  let pageNo = 1;

  function footer() {
    // Written below the bottom margin, so lift it while drawing or pdfkit
    // would start a new page
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#888888')
      .text(`${model.title}  ·  page ${pageNo}`, MARGIN, 842 - 32, {
        width: pageW - MARGIN * 2,
        align: 'center',
        lineBreak: false,
      });
    doc.page.margins.bottom = saved;
  }

  function newPage() {
    doc.addPage();
    pageNo += 1;
    col = 0;
    colTop = MARGIN;
    y = colTop;
    footer();
  }

  // Make room for `h` more points. Moves to the next column (or page) when
  // it doesn't fit; returns true if it moved, so callers can repeat a
  // heading for a group that got split.
  function ensure(h) {
    if (y + h <= BOTTOM) return false;
    if (col === 0) {
      col = 1;
      y = colTop;
    } else {
      newPage();
    }
    return true;
  }

  function groupHeading(text, owned, total) {
    const stats = `${owned} / ${total}  (${percent(owned, total)}%)`;
    const x = colX(col);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000000').text(text, x, y, { lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#666666')
      .text(stats, x, y + 1.5, { width: colW, align: 'right', lineBreak: false });
    doc
      .moveTo(x, y + 15)
      .lineTo(x + colW, y + 15)
      .lineWidth(0.6)
      .strokeColor('#999999')
      .stroke();
    y += 20;
  }

  function row(item) {
    const x = colX(col);

    // Checkbox, with a tick when owned
    doc.lineWidth(0.8).strokeColor('#000000').rect(x, y + 1, BOX, BOX).stroke();
    if (item.owned > 0) {
      doc
        .lineWidth(1.6)
        .strokeColor('#000000')
        .moveTo(x + 1.6, y + 5.2)
        .lineTo(x + 3.6, y + 7.6)
        .lineTo(x + 7.2, y + 1.6)
        .stroke();
    }

    const qty = item.owned > 1 ? `  x${item.owned}` : '';
    const label = `${item.set.toUpperCase()} ${item.number}${item.upcoming ? ' *' : ''}`;
    const labelW = 62;
    const nameX = x + BOX + 6;

    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#000000')
      .text(item.name + qty, nameX, y + 1, {
        width: colW - (nameX - x) - labelW - 4,
        height: 10,
        ellipsis: true,
      });
    doc
      .fontSize(7.5)
      .fillColor('#777777')
      .text(label, x + colW - labelW, y + 1.5, { width: labelW, align: 'right', lineBreak: false });

    y += ROW_H;
  }

  // ── Title block ──
  footer();
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#000000').text(model.title, MARGIN, y, { lineBreak: false });
  y += 28;
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#555555')
    .text(
      `${model.owned} of ${model.total} owned (${percent(model.owned, model.total)}%)  ·  ${model.generatedAt}` +
        (model.upcoming ? '  ·  includes upcoming cards (*)' : ''),
      MARGIN,
      y,
      { lineBreak: false }
    );
  y += 22;

  // ── Sections ──
  model.sections.forEach((section, index) => {
    if (index > 0) newPage();

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000').text(section.label, MARGIN, y, { lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#555555')
      .text(
        `${section.owned} / ${section.total}  (${percent(section.owned, section.total)}%)`,
        MARGIN,
        y + 3,
        { width: pageW - MARGIN * 2, align: 'right', lineBreak: false }
      );
    y += 24;
    col = 0;
    colTop = y;

    if (section.groups.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor('#777777').text('No cards.', MARGIN, y, { lineBreak: false });
      return;
    }

    for (const group of section.groups) {
      // Keep a heading with at least two rows under it
      ensure(20 + ROW_H * 2);
      if (group.label) groupHeading(group.label, group.owned, group.total);

      for (const item of group.items) {
        if (ensure(ROW_H) && group.label) {
          groupHeading(`${group.label} (cont.)`, group.owned, group.total);
        }
        row(item);
      }
      y += 8;
    }
  });

  doc.end();
}

module.exports = { buildChecklistModel, renderChecklistPdf };
