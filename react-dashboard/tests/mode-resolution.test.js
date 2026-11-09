import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveModeStatus} from '../src/tracking/commands.js';
import {labelMode} from '../src/tracking/labelStatus.js';
const dog={id:104,masterId:5};
const confirmed={master_id:201,slave_id:104,status:'confirmed',action:'sleep',reported_mode:0,
  created_at:'2026-11-09T02:57:28Z',completed_at:'2026-11-09T02:57:49Z'};
const resolve = states => resolveModeStatus(dog,[5,201],states);
test('Master201 confirmation is used even when Master5 has no command',()=>{
 const mode=resolve({'5:104':{ready:true},'201:104':{ready:true,command:confirmed}});
 assert.equal(mode.masterId,201);assert.equal(labelMode({...dog,modeStatus:mode}),'省電待機');
});
test('newer unconfirmed Master5 requests retain a qualified last confirmation',()=>{
 const mode=resolve({'5:104':{ready:true,command:{master_id:5,slave_id:104,status:'unconfirmed',action:'sleep',created_at:'2026-11-09T03:00:00Z'}},
 '201:104':{ready:true,command:confirmed}});
 assert.equal(labelMode({...dog,modeStatus:mode}),'省電待機（上次確認）');
});
test('last confirmed row survives a newer failed request on the same Master',()=>{
 const mode=resolve({'5:104':{ready:true},'201:104':{ready:true,confirmed,command:{...confirmed,status:'unconfirmed',reported_mode:null,created_at:'2026-11-09T03:00:00Z'}}});
 assert.equal(labelMode({...dog,modeStatus:mode}),'省電待機（上次確認）');
});
test('newest confirmation wins and read failures qualify rather than invent modes',()=>{
 const next={...confirmed,master_id:5,reported_mode:1,action:'tracking',created_at:'2026-11-09T03:01:00Z',completed_at:'2026-11-09T03:01:10Z'};
 const mode=resolve({'5:104':{ready:true,command:next},'201:104':{ready:true,command:confirmed}});
 assert.equal(labelMode({...dog,modeStatus:mode}),'追蹤中');
 const stale=resolve({'5:104':{ready:false,confirmed:next},'201:104':{ready:true,command:confirmed}});
 assert.equal(labelMode({...dog,modeStatus:stale}),'追蹤中（上次確認）');
});
test('unauthorized masters, other slaves and conflicting equal-time modes do not supply a mode',()=>{
 assert.equal(resolveModeStatus(dog,[5],{'201:104':{ready:true,command:confirmed}}).command,null);
 assert.equal(resolve({'5:104':{ready:true},'201:104':{ready:true,command:{...confirmed,slave_id:108}}}).command,null);
 assert.equal(resolve({'5:104':{ready:true,command:{...confirmed,master_id:5,reported_mode:1}},'201:104':{ready:true,command:confirmed}}).command,null);
});

test('a pending request blocks an older health observation when no command is confirmed',()=>{
 const pending={master_id:5,slave_id:104,status:'queued',action:'tracking',created_at:'2026-11-09T03:00:00Z'};
 const mode=resolve({'5:104':{ready:true,command:pending},'201:104':{ready:true}});
 assert.equal(labelMode({...dog,modeStatus:mode,healthDisplay:{master_id:5,slave_id:104,mode:0,received_at:'2026-11-09T02:00:00Z'}}),'未知');
});
