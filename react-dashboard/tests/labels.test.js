import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLabelOverlap } from '../src/tracking/labels.js';

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
