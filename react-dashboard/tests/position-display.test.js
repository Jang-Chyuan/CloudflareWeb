import test from 'node:test';
import assert from 'node:assert/strict';
import { positionDisplayState, LIVE_WINDOW } from '../src/tracking/telemetry.js';
const now = Date.parse('2026-11-02T06:04:04Z');
const recent = { position: [25,121], lastPositionAt: now-240000, retained: false, stale: false };
test('fresh GPS is normal; missing newest fix retains a recent position in yellow', () => {
  assert.equal(positionDisplayState(recent,now),'current');
  assert.equal(positionDisplayState({...recent,retained:true,stale:true},now),'retained');
  assert.equal(positionDisplayState({...recent,lastDisplayed:true,stale:true},now),'retained');
});
test('cross appears only after position exceeds 35 minutes, even if packets keep arriving', () => {
  assert.equal(positionDisplayState({...recent,lastPositionAt:now-LIVE_WINDOW,retained:true},now),'retained');
  assert.equal(positionDisplayState({...recent,lastPositionAt:now-LIVE_WINDOW-1,lastPacketAt:now},now),'expired');
  assert.equal(positionDisplayState({...recent,position:null},now),'unavailable');
});
