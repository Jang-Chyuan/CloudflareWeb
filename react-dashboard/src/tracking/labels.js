// Move a label upward until it clears all labels already placed.
export function clearLabelOverlap(rect, placed, gap = 6) {
  // DOMRect coordinates are prototype getters, so object spread loses them.
  let box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  for (;;) {
    const collisions = placed.filter(other => box.left < other.right + gap && box.right + gap > other.left
      && box.top < other.bottom + gap && box.bottom + gap > other.top);
    if (!collisions.length) return box.top - rect.top;
    const shift = box.bottom - Math.min(...collisions.map(other => other.top)) + gap;
    box = { ...box, top: box.top - shift, bottom: box.bottom - shift };
  }
}

export function placeDogLabel(point, width, height, placed, icons, bounds) {
  const overlaps = (a, b) => a.left < b.right + 6 && a.right + 6 > b.left
    && a.top < b.bottom + 6 && a.bottom + 6 > b.top;
  for (let ring = 0; ring < placed.length + icons.length + 10; ring++) {
    const distance = 29 + ring * (Math.max(width, height) + 10);
    const candidates = [
      [point.x - width / 2, point.y - distance - height, 'top'],
      [point.x + distance, point.y - height / 2, 'right'],
      [point.x - width / 2, point.y + distance, 'bottom'],
      [point.x - distance - width, point.y - height / 2, 'left'],
    ];
    for (const [left, top, side] of candidates) {
      const box = { left, top, right: left + width, bottom: top + height, side };
      if (box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom) continue;
      if (![...placed, ...icons].some(other => overlaps(box, other))) return box;
    }
  }
  const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - 29 - height, bottom: point.y - 29 };
  const shift = clearLabelOverlap(box, [...placed, ...icons]);
  return { ...box, top: box.top + shift, bottom: box.bottom + shift, side: 'top' };
}
