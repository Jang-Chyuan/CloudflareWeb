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
