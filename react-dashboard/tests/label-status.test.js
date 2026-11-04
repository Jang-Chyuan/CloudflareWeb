import test from 'node:test';
import assert from 'node:assert/strict';
import { labelStatus, labelMode } from '../src/tracking/labelStatus.js';
import { modeMasterId } from '../src/tracking/commands.js';
const at = Date.parse('2026-11-02T01:00:00Z');
const dog = { id: 102, masterId: 201, lastPacketAt: at, lastPositionAt: at - 60000,
  battery: 79, packet: { received_at: at, rssi: -85 },
  healthDisplay: { master_id: 201, slave_id: 102, received_at: new Date(at - 1000).toISOString(),
    battery_valid: true, battery_pct: 80, rssi: -91 } };

test('relayed GPS uses the authorized control Master for modes without replacing packet sources', () => {
  for (const id of [102, 104, 108]) {
    const relayed = { ...dog, id, masterId: 7, healthDisplay: null };
    assert.equal(modeMasterId(relayed, [7, 201]), 201);
    assert.equal(modeMasterId(relayed, [7]), 7);
    const command = { master_id: 201, slave_id: id, status: 'confirmed', reported_mode: 0,
      completed_at: new Date(at + 500).toISOString() };
    const input = { ...relayed, modeStatus: { masterId: 201, command, ready: true } };
    assert.equal(labelMode(input), '省電待機');
    assert.equal(labelMode({ ...input, modeStatus: { ...input.modeStatus, ready: false } }), '省電待機（上次確認）');
    assert.equal(labelStatus(input).source, 'dog_telemetry');
    assert.equal(input.masterId, 7);
    assert.equal(labelMode({ ...input, modeStatus: { ...input.modeStatus, masterId: 7 } }), '未知');
    for (const invalid of [{ slave_id: 109 }, { master_id: 9 }, { status: 'queued' }, { reported_mode: null }, { completed_at: null }]) {
      assert.equal(labelMode({ ...input, modeStatus: { ...input.modeStatus, command: { ...command, ...invalid } } }), '未知');
    }
  }
  assert.equal(modeMasterId({ id: 9, masterId: 7 }, [7, 201]), 7);
});
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

test('map mode uses confirmed commands and newer matching health reports', () => {
  const command = { master_id: 201, slave_id: 102, status: 'confirmed', reported_mode: 1,
    created_at: new Date(at).toISOString(), completed_at: new Date(at + 500).toISOString() };
  const input = { ...dog, modeStatus: { ready: true, command } };
  assert.equal(labelMode(input), '追蹤中');
  const health = { ...dog.healthDisplay, received_at: new Date(at + 1000).toISOString(), mode: 0 };
  assert.equal(labelMode({ ...input, healthDisplay: health }), '省電待機');
  assert.equal(labelMode({ ...input, healthDisplay: { ...health, master_id: 7 } }), '追蹤中');
  assert.equal(labelMode({ ...input, modeStatus: { ready: true, command: { ...command, reported_mode: 0 } } }), '省電待機');
});

test('map mode never assumes an unconfirmed request succeeded', () => {
  for (const status of ['queued', 'claimed', 'unconfirmed', 'expired', 'rejected']) {
    const command = { master_id: 201, slave_id: 102, status, reported_mode: 0,
      created_at: new Date(at + 2000).toISOString(), completed_at: null };
    assert.equal(labelMode({ ...dog, healthDisplay: { ...dog.healthDisplay, mode: 1 },
      modeStatus: { ready: true, command } }), '未知');
  }
  assert.equal(labelMode(dog), '未知');
  assert.equal(labelMode({ ...dog, modeStatus: { ready: false } }), '未知');
  assert.equal(labelMode({ ...dog, healthDisplay: { ...dog.healthDisplay, mode: 0 },
    modeStatus: { ready: true, command: null } }), '省電待機');
});

test('temporary mode read failure preserves a confirmed mode with an explicit qualifier', () => {
  const command = { master_id: 201, slave_id: 102, status: 'confirmed', reported_mode: 1,
    completed_at: new Date(at).toISOString() };
  assert.equal(labelMode({ ...dog, modeStatus: { ready: false, command } }), '追蹤中（上次確認）');
  assert.equal(labelMode({ ...dog, modeStatus: { ready: false, command: { ...command, reported_mode: 0 } } }), '省電待機（上次確認）');
  assert.equal(labelMode({ ...dog, modeStatus: { ready: false, command: { ...command, status: 'unconfirmed' } } }), '未知');
});
