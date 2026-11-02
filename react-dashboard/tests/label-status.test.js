import test from 'node:test';
import assert from 'node:assert/strict';
import { labelStatus } from '../src/tracking/labelStatus.js';
const at = Date.parse('2026-11-02T01:00:00Z');
const dog = { id: 102, masterId: 201, lastPacketAt: at, lastPositionAt: at - 60000,
  battery: 79, packet: { received_at: at, rssi: -85 },
  healthDisplay: { master_id: 201, slave_id: 102, received_at: new Date(at - 1000).toISOString(),
    battery_valid: true, battery_pct: 80, rssi: -91 } };
test('tracking and scheduled GPS status use newer telemetry', () => {
  assert.deepEqual(labelStatus(dog), {source: 'dog_telemetry', packetAt: at, battery: 79, rssi: -85});
  assert.equal(labelStatus({...dog, healthDisplay: null}).source, 'dog_telemetry');
});
test('newer health supplies all status fields without replacing GPS', () => {
  const health = {...dog.healthDisplay, received_at: new Date(at + 1000).toISOString()};
  const input = {...dog, healthDisplay: health};
  assert.deepEqual(labelStatus(input), {source: 'dog_health', packetAt: at + 1000, battery: 80, rssi: -91});
  assert.equal(input.lastPositionAt, at - 60000);
  assert.equal(labelStatus({...input, healthDisplay: {...health, battery_valid: false}}).battery, null);
  assert.equal(labelStatus({...input, healthDisplay: {...health, master_id: 7}}).source, 'dog_telemetry');
  assert.equal(labelStatus({...input, healthDisplay: {...health, slave_id: 104}}).source, 'dog_telemetry');
});
test('a later tracking status wins again even with no GPS fix', () => {
  const input = {...dog, position: null, battery: null, packet: {...dog.packet, received_at: at + 5000},
    lastPacketAt: at + 5000, healthDisplay: {...dog.healthDisplay, received_at: new Date(at + 1000).toISOString()}};
  assert.deepEqual(labelStatus(input), {source: 'dog_telemetry', packetAt: at + 5000, battery: null, rssi: -85});
});
test('historical map without health continues to use telemetry', () => {
  const {healthDisplay, ...historical} = dog;
  assert.equal(labelStatus(historical).source, 'dog_telemetry');
});
