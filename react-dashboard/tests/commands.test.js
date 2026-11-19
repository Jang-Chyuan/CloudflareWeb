import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceCommand, commandLabel, deviceMode } from '../src/tracking/commands.js';
test('tracking and sleep use fixed target and caller retry UUID', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, args]); return { data: { id: 'command', action: args.p_action, status: 'queued' } }; } };
  for (const action of ['tracking', 'sleep']) await createDeviceCommand(client, action, 'retry-id');
  assert.deepEqual(calls.map(([name, args]) => [name, args.p_master_id, args.p_slave_id, args.p_action, args.p_request_id]),
    [['create_device_command', 5, 102, 'tracking', 'retry-id'], ['create_device_command', 5, 102, 'sleep', 'retry-id']]);
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
 assert.equal(row.slave_id,108);assert.equal(calls[0].p_master_id,5);
 await assert.rejects(createDeviceCommand(client,'tracking','bad',106));
 assert.equal(calls.length,1);
});


test('Slave 104 tracking/sleep preserve target and authorized Master', async () => {
 const calls=[];
 const client={rpc:async(name,args)=>{calls.push(args);return {data:{id:'104',slave_id:args.p_slave_id}};}};
 for(const action of ['tracking','sleep']) {
  const row=await createDeviceCommand(client,action,'request-104-'+action,104);
  assert.equal(row.slave_id,104);
  assert.equal(calls.at(-1).p_master_id,5);
  assert.equal(calls.at(-1).p_action,action);
 }
 await assert.rejects(createDeviceCommand(client,'tracking','bad',106));
 assert.equal(calls.length,2);
});

 test('Master201 target is explicit and unsupported Masters never reach RPC', async () => {
 const calls=[];
 const client={rpc:async(name,args)=>{calls.push(args);return {data:{id:'ok'}};}};
 for(const slave of [8,102,104,108]) for(const action of ['tracking','sleep'])
  await createDeviceCommand(client,action,'id-'+slave+'-'+action,slave,201);
 assert.deepEqual(calls.map(c=>c.p_master_id),Array(8).fill(201));
 await assert.rejects(createDeviceCommand(client,'sleep','bad',102,7));
 assert.equal(calls.length,8);
 });

test('Slave 8 supports tracking and sleep through either Master', async () => {
 const calls=[];
 const client={rpc:async(name,args)=>{calls.push(args);return {data:{id:'slave8',slave_id:args.p_slave_id}};}};
 for(const master of [5,201]) for(const action of ['tracking','sleep']) {
  const row=await createDeviceCommand(client,action,'request-8',8,master);
  assert.equal(row.slave_id,8);
  assert.deepEqual(calls.at(-1),{p_master_id:master,p_slave_id:8,p_action:action,p_request_id:'request-8'});
 }
});

test('Slave 6 commands use Master 5 and reject Master 201 before RPC', async () => {
  const calls = [];
  const client = {rpc: async (name, args) => { calls.push({name, args}); return {data: {id:'ok'}}; }};
  for (const slave of [6]) for (const action of ['tracking', 'sleep']) {
    await createDeviceCommand(client, action, 'retry-' + slave, slave, 5);
    assert.deepEqual(calls.at(-1), {name:'create_device_command', args:{p_master_id:5,p_slave_id:slave,p_action:action,p_request_id:'retry-' + slave}});
    await assert.rejects(createDeviceCommand(client, action, 'bad', slave, 201));
  }
  assert.equal(calls.length, 2);
});

test('Slave 6 mode reads use the authorized Master 5 controller', async () => {
  const {controlMasters, modeMasterId, resolveModeStatus, supportsControl} = await import('../src/tracking/commands.js');
  for (const slave of [6]) {
    assert.equal(supportsControl(slave), true);
    assert.deepEqual(controlMasters([5,201], slave), [5]);
    assert.deepEqual(controlMasters([201], slave), []);
    assert.equal(modeMasterId({id:slave,masterId:7}, [5,201]), 5);
    const command = {master_id:5,slave_id:slave,status:'confirmed',reported_mode:1,created_at:'2026-11-13T00:00:00Z',completed_at:'2026-11-13T00:00:01Z'};
    const result = resolveModeStatus({id:slave,masterId:7}, [5,201], {[`5:${slave}`]:{command,ready:true}});
    assert.equal(result.command, command);
    assert.equal(result.ready, true);
    assert.equal(result.masterId, 5);
  }
});

test('Slave 4 supports authorized Master 201 tracking and sleep', async () => {
  const {controlMasters, resolveModeStatus} = await import('../src/tracking/commands.js');
  assert.deepEqual(controlMasters([5,201], 4), [5,201]);
  assert.deepEqual(controlMasters([201], 4), [201]);
  assert.deepEqual(controlMasters([], 4), []);
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push(args);return {data:{id:'slave4'}};}};
  for(const master of [5,201]) for(const action of ['tracking','sleep']) {
    await createDeviceCommand(client,action,'slave4-'+action,4,master);
    assert.deepEqual(calls.at(-1),{p_master_id:master,p_slave_id:4,p_action:action,p_request_id:'slave4-'+action});
  }
  const command={master_id:201,slave_id:4,status:'confirmed',reported_mode:1,completed_at:'2026-11-18T13:00:00Z'};
  const result=resolveModeStatus({id:4,masterId:201},[201],{'201:4':{command,ready:true}});
  assert.equal(result.command,command);
  assert.equal(result.masterId,201);
});
