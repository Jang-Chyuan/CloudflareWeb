import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceCommand, commandLabel, deviceMode } from '../src/tracking/commands.js';
test('tracking and sleep use fixed target and caller retry UUID', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { id: 'command', action: args.p_action, status: 'queued' } }; } };
  for (const action of ['tracking', 'sleep']) await createDeviceCommand(client, action, 'retry-id');
  assert.deepEqual(calls.map(([name, args]) => [name, args.p_master_id, args.p_slave_id, args.p_action, args.p_request_id]),
    [['create_device_command', 201, 102, 'tracking', 'retry-id'], ['create_device_command', 201, 102, 'sleep', 'retry-id']]);
  await assert.rejects(createDeviceCommand(client, 'wake', 'retry-id'));
});
test('write errors propagate and queued never claims execution success', async () => {
  await assert.rejects(createDeviceCommand({ rpc: async () => ({ error: new Error('denied') }) }, 'sleep', 'id'), /denied/);
  assert.match(commandLabel({ action: 'tracking', status: 'queued', expires_at: '2099-01-01' }), /等待裝置確認/);
  assert.match(commandLabel({ action: 'sleep', status: 'unconfirmed' }), /裝置模式未知/);
  assert.match(commandLabel({ action: 'tracking', status: 'queued', expires_at: '2000-01-01' }), /未收到確認/);
  assert.match(commandLabel({ action: 'sleep', status: 'confirmed' }), /裝置已回覆省電命令/);
});

test('mode requires confirmed result, reported mode and confirmation timestamp', () => {
  const completed_at = '2026-11-01T02:00:00Z';
  for (const status of ['queued', 'claimed', 'expired', 'unconfirmed', 'rejected'])
    assert.equal(deviceMode({ status, reported_mode: 1, completed_at }).label, '未知');
  assert.equal(deviceMode({ status: 'confirmed', action: 'tracking' }).label, '未知');
  assert.equal(deviceMode({ status: 'confirmed', reported_mode: 1, completed_at: 'bad' }).label, '未知');
  assert.deepEqual(deviceMode({ status: 'confirmed', reported_mode: 1, completed_at }),
    { label: '追蹤中', tracking: true, confirmedAt: completed_at });
  assert.deepEqual(deviceMode({ status: 'confirmed', action: 'tracking', reported_mode: 0, completed_at }),
    { label: '省電待機', tracking: false, confirmedAt: completed_at });
  assert.equal(commandLabel({ status: 'claimed', expires_at: '2000-01-01' }), '未收到確認，裝置模式未知');
});

test('Slave 108 commands preserve target and reject unsupported slaves', async () => {
 const calls=[];
 const client={rpc:async(name,args)=>{calls.push(args);return {data:{id:'108',slave_id:args.p_slave_id}};}};
 const row=await createDeviceCommand(client,'tracking','request-108',108);
 assert.equal(row.slave_id,108);assert.equal(calls[0].p_master_id,201);
 await assert.rejects(createDeviceCommand(client,'tracking','bad',106));
 assert.equal(calls.length,1);
});


test('Slave 104 tracking/sleep preserve target and authorized Master', async () => {
 const calls=[];
 const client={rpc:async(name,args)=>{calls.push(args);return {data:{id:'104',slave_id:args.p_slave_id}};}};
 for(const action of ['tracking','sleep']) {
  const row=await createDeviceCommand(client,action,'request-104-'+action,104);
  assert.equal(row.slave_id,104);
  assert.equal(calls.at(-1).p_master_id,201);
  assert.equal(calls.at(-1).p_action,action);
 }
 await assert.rejects(createDeviceCommand(client,'tracking','bad',106));
 assert.equal(calls.length,2);
});
