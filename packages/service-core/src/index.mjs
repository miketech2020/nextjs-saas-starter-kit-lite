/** Declarative service modules; infrastructure must not switch on module keys. */
export const modules = Object.freeze({
  carwash: { key: 'carwash', name: 'Rửa xe', unit: 'lượt', steps: ['received','washing','inspection','completed'], capabilities: ['vehicle','device-session','membership'], services: [
    { code: 'self-wash', name: 'Tự rửa xe', price: 30000, durationSeconds: 600, deviceKind: 'wash-bay' },
    { code: 'staff-wash', name: 'Rửa xe có nhân viên', price: 70000, durationSeconds: 1800, deviceKind: null },
    { code: 'vacuum', name: 'Hút bụi', price: 20000, durationSeconds: 300, deviceKind: 'vacuum' },
  ]},
  laundry: { key: 'laundry', name: 'Giặt ủi', unit: 'mẻ', steps: ['received','washing','drying','folding','ready','completed'], capabilities: ['device-session','weight','pickup','membership'], services: [
    { code: 'wash', name: 'Giặt tự phục vụ', price: 40000, durationSeconds: 1800, deviceKind: 'washer' },
    { code: 'dry', name: 'Sấy tự phục vụ', price: 30000, durationSeconds: 1200, deviceKind: 'dryer' },
    { code: 'wash-fold', name: 'Giặt và gấp có nhân viên', price: 25000, durationSeconds: 0, deviceKind: null },
  ]},
});
export function findService(moduleKey, serviceCode) {
  const service = modules[moduleKey]?.services.find(s => s.code === serviceCode);
  if (!service) throw new Error('Dịch vụ không hợp lệ');
  return service;
}
export function nextStep(moduleKey, current) {
  const steps = modules[moduleKey]?.steps;
  const index = steps?.indexOf(current) ?? -1;
  if (index < 0) throw new Error('Trạng thái không hợp lệ');
  return steps[index + 1] ?? null;
}
export function validateDevice(service, device) {
  if (!service.device_kind && !service.deviceKind) return;
  if (!device || device.kind !== (service.device_kind ?? service.deviceKind)) throw new Error('Sai loại thiết bị');
  if (device.status !== 'idle') throw new Error('Thiết bị chưa sẵn sàng');
  const seen=Date.parse(device.last_seen_at ?? '');
  if (!Number.isFinite(seen) || Date.now()-seen>90000 || seen-Date.now()>30000) throw new Error('Thiết bị mất kết nối');
}
export function commandPayload(session) {
  if (!Number.isInteger(session.duration_seconds) || session.duration_seconds <= 0) throw new Error('Thời lượng không hợp lệ');
  return { version: 1, commandId: session.id, sessionId: session.id, action: 'START', durationSeconds: session.duration_seconds, expiresAt: session.command_expires_at };
}
