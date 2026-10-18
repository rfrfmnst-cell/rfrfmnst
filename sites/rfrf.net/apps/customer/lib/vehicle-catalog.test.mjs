import test from 'node:test';
import assert from 'node:assert/strict';
import { findVehicleBrands, vehicleCategory, vehicleTrimSuggestions, vehicleRequestText } from './vehicle-catalog.ts';

test('brand search handles Arabic aliases and Latin brand names', () => {
  assert.equal(findVehicleBrands('cars', 'هوندا')[0].id, 'honda');
  assert.equal(findVehicleBrands('cars', 'HYUNDAI')[0].id, 'hyundai');
  assert.equal(findVehicleBrands('cars', 'ايسوزو')[0].id, 'isuzu');
});
test('heavy equipment does not show unrelated passenger-only brands', () => {
  assert.equal(findVehicleBrands('equipment', 'Toyota').length, 0);
  assert.equal(findVehicleBrands('equipment', 'CAT')[0].id, 'caterpillar');
  assert.equal(vehicleCategory(['cars']), 'all');
});
test('verified trim suggestions cannot leak to a different year or model', () => {
  assert.ok(vehicleTrimSuggestions('toyota', 'كامري', '2026').includes('LE'));
  assert.deepEqual(vehicleTrimSuggestions('toyota', 'كورولا', '2026'), []);
  assert.deepEqual(vehicleTrimSuggestions('toyota', 'كامري', '2005'), []);
});
test('intake preserves manual variants without inventing compatibility', () => {
  const text = vehicleRequestText({brand:'honda',model:'أكورد',year:'2012',trim:'EX-L',part:'دينمو 000123'});
  assert.ok(text.includes('2012'));
  assert.ok(text.includes('000123'));
  assert.ok(text.includes('EX-L'));
});
test('incomplete or impossible vehicle selections cannot be handed off', () => {
  for (const patch of [{brand:'unknown'}, {year:'2000.5'}, {year:'9999'}, {trim:''}, {model:''}]) {
    assert.equal(vehicleRequestText({brand:'toyota',model:'كامري',year:'2026',trim:'LE',...patch}), null);
  }
});

test('Chinese filter combines vehicle categories and common Arabic spelling aliases', () => {
  for (const [query, id] of [['شانغان','changan'],['امجي','mg'],['بيوايدي','byd'],['لينك اند كو','lynkco'],['سكاي ويل','skyworth'],['ليشيانغ','li-auto']]) {
    assert.ok(findVehicleBrands('cars', query, true).some(brand => brand.id === id), query);
  }
  assert.deepEqual(findVehicleBrands('cars', 'Toyota', true), []);
  assert.ok(findVehicleBrands('equipment', 'ساني', true).some(brand => brand.id === 'sany'));
  assert.deepEqual(findVehicleBrands('equipment', 'جيلي', true), []);
  assert.equal(findVehicleBrands('cars', 'GMC', true).length, 0);
  assert.ok(findVehicleBrands('cars', 'JMC', true).some(brand => brand.id === 'jmc'));
});
test('new Chinese make details preserve exact model and part numbers during handoff', () => {
  const text = vehicleRequestText({brand:'zeekr',model:'001',year:'2026',trim:'غير معروفة',part:'00071-AB'});
  assert.ok(text.includes('زيكر'));
  assert.ok(text.includes('001'));
  assert.ok(text.includes('00071-AB'));
  assert.deepEqual(vehicleTrimSuggestions('byd', 'SEAL', '2026'), []);
});
