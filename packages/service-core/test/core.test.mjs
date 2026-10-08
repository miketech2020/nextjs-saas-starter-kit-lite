import test from 'node:test';
import assert from 'node:assert/strict';
import { findService, nextStep, validateDevice, commandPayload } from '../src/index.mjs';
test('rửa xe và giặt dùng cùng hợp đồng nhưng quy trình khác nhau', () => {
  assert.equal(findService('carwash','self-wash').deviceKind,'wash-bay');
  assert.equal(findService('laundry','wash').deviceKind,'washer');
  assert.equal(nextStep('laundry','drying'),'folding');
  assert.equal(nextStep('carwash','inspection'),'completed');
  assert.equal(nextStep('laundry','completed'),null);
  assert.throws(() => findService('parking','wash'));
});
test('không kích sai máy, máy bận hoặc heartbeat quá hạn', () => {
  const service = findService('laundry','wash');
  const device = { kind:'washer',status:'idle',last_seen_at:new Date().toISOString() };
  assert.doesNotThrow(() => validateDevice(service,device));
  assert.throws(() => validateDevice(service,{...device,kind:'dryer'}));
  assert.throws(() => validateDevice(service,{...device,status:'running'}));
  assert.throws(() => validateDevice(service,{...device,last_seen_at:'2020-01-01'}));
  assert.throws(() => validateDevice(service,{...device,last_seen_at:'INVALID_DATE'}));
  assert.throws(() => validateDevice(service,{...device,last_seen_at:new Date(Date.now()+60000).toISOString()}));
});
test('retry giữ nguyên command ID để thiết bị loại trùng', () => {
  const session = {id:'one',duration_seconds:600,command_expires_at:'2026-10-09'};
  assert.deepEqual(commandPayload(session),commandPayload(session));
  assert.equal(commandPayload(session).commandId,session.id);
  assert.throws(() => commandPayload({...session,duration_seconds:-1}));
});
