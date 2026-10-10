import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLabelOverlap, placeDogLabel } from '../src/tracking/labels.js';

test('four clustered dogs use different sides without overlapping labels or icons', () => {
  const point = { x: 200, y: 200 }, placed = [];
  const icons = [{ left: 181, right: 219, top: 181, bottom: 219 }];
  const bounds = { left: 0, top: 0, right: 400, bottom: 400 };
  for (let i = 0; i < 4; i++) placed.push(placeDogLabel(point, 60, 28, placed, icons, bounds));
  assert.deepEqual(placed.map(box => box.side), ['top', 'right', 'bottom', 'left']);
});

test('browser DOMRect prototype getters are used for collision detection', () => {
  class BrowserRect {
    get left() { return 10; }
    get right() { return 110; }
    get top() { return 200; }
    get bottom() { return 225; }
  }
  assert.equal(clearLabelOverlap(new BrowserRect(),
    [{ left: 10, right: 110, top: 200, bottom: 225 }]), -31);
});

test('nearby and identical dog labels clear every previously placed label', () => {
  const placed = [];
  for (let i = 0; i < 8; i++) {
    const rect = { left: i % 2 * 10, right: 120 + i % 2 * 10, top: 200, bottom: 225 };
    const shift = clearLabelOverlap(rect, placed);
    const box = { ...rect, top: rect.top + shift, bottom: rect.bottom + shift };
    for (const other of placed) assert.ok(box.bottom + 6 <= other.top);
    placed.push(box);
  }
});

test('separated labels keep their original positions', () => {
  assert.equal(clearLabelOverlap({ left: 200, right: 300, top: 10, bottom: 30 },
    [{ left: 0, right: 100, top: 10, bottom: 30 }]), 0);
});
