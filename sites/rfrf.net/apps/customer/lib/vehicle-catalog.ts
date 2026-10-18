export type VehicleCategory = 'all' | 'cars' | 'trucks' | 'equipment';
export interface VehicleBrand { id: string; name: string; latin: string; categories: VehicleCategory[]; models: string[]; }

// Model names are intake suggestions, not a fitment or production-year database.
export const VEHICLE_BRANDS: VehicleBrand[] = [
  { id: 'toyota', name: 'تويوتا', latin: 'Toyota', categories: ['cars'], models: ['كامري', 'كورولا', 'يارس', 'أفالون', 'لاندكروزر', 'برادو', 'فورتشنر', 'راف فور', 'هايلكس', 'هايس'] },
  { id: 'honda', name: 'هوندا', latin: 'Honda', categories: ['cars'], models: ['أكورد', 'سيفيك', 'سيتي', 'CR-V', 'HR-V', 'ZR-V', 'بايلوت', 'أوديسي'] },
  { id: 'hyundai', name: 'هيونداي', latin: 'Hyundai', categories: ['cars', 'trucks'], models: ['إلنترا', 'سوناتا', 'أكسنت', 'أزيرا', 'توسان', 'سانتافي', 'باليسيد', 'ستاريا', 'بورتر', 'مايتي'] },
  { id: 'nissan', name: 'نيسان', latin: 'Nissan', categories: ['cars'], models: ['باترول', 'صني', 'ألتيما', 'ماكسيما', 'إكس تريل', 'باثفايندر', 'إكس تيرا', 'نافارا', 'كيكس'] },
  { id: 'kia', name: 'كيا', latin: 'Kia', categories: ['cars'], models: ['سيراتو', 'K5', 'K8', 'بيكانتو', 'سيلتوس', 'سبورتاج', 'سورينتو', 'كارنفال'] },
  { id: 'ford', name: 'فورد', latin: 'Ford', categories: ['cars', 'trucks'], models: ['تورس', 'موستانج', 'إكسبلورر', 'إكسبيديشن', 'إيدج', 'إيفرست', 'رينجر', 'F-150', 'ترانزيت', 'F-MAX'] },
  { id: 'chevrolet', name: 'شفروليه', latin: 'Chevrolet', categories: ['cars'], models: ['تاهو', 'سوبربان', 'سيلفرادو', 'ماليبو', 'إمبالا', 'كابتيفا', 'ترافيرس', 'كروز'] },
  { id: 'gmc', name: 'جي إم سي', latin: 'GMC', categories: ['cars'], models: ['يوكن', 'سييرا', 'أكاديا', 'تيرين', 'سافانا'] },
  { id: 'lexus', name: 'لكزس', latin: 'Lexus', categories: ['cars'], models: ['ES', 'LS', 'IS', 'LX', 'GX', 'RX', 'NX', 'UX'] },
  { id: 'mazda', name: 'مازدا', latin: 'Mazda', categories: ['cars'], models: ['مازدا 3', 'مازدا 6', 'CX-3', 'CX-30', 'CX-5', 'CX-9', 'CX-60', 'CX-90'] },
  { id: 'mitsubishi', name: 'ميتسوبيشي', latin: 'Mitsubishi', categories: ['cars'], models: ['باجيرو', 'مونتيرو سبورت', 'أوتلاندر', 'إكليبس كروس', 'إكسباندر', 'أتراج', 'L200'] },
  { id: 'suzuki', name: 'سوزوكي', latin: 'Suzuki', categories: ['cars'], models: ['جمني', 'سويفت', 'بالينو', 'سياز', 'إرتيجا', 'فيتارا'] },
  { id: 'bmw', name: 'بي إم دبليو', latin: 'BMW', categories: ['cars'], models: ['الفئة الثالثة', 'الفئة الخامسة', 'الفئة السابعة', 'X1', 'X3', 'X5', 'X6', 'X7'] },
  { id: 'mercedes', name: 'مرسيدس بنز', latin: 'Mercedes-Benz', categories: ['cars', 'trucks'], models: ['C-Class', 'E-Class', 'S-Class', 'GLC', 'GLE', 'GLS', 'G-Class', 'سبرنتر', 'أكتروس', 'أروكس'] },
  { id: 'audi', name: 'أودي', latin: 'Audi', categories: ['cars'], models: ['A3', 'A4', 'A5', 'A6', 'A8', 'Q3', 'Q5', 'Q7', 'Q8'] },
  { id: 'volkswagen', name: 'فولكس واجن', latin: 'Volkswagen', categories: ['cars'], models: ['جولف', 'باسات', 'جيتا', 'تيجوان', 'طوارق', 'تيرامونت', 'أماروك'] },
  { id: 'isuzu', name: 'إيسوزو', latin: 'Isuzu', categories: ['cars', 'trucks'], models: ['D-MAX', 'MU-X', 'N-Series', 'F-Series', 'Giga'] },
  { id: 'volvo', name: 'فولفو', latin: 'Volvo', categories: ['cars', 'trucks', 'equipment'], models: ['S60', 'S90', 'XC40', 'XC60', 'XC90', 'FH', 'FM', 'FMX', 'حفار EC', 'شيول L'] },
  { id: 'scania', name: 'سكانيا', latin: 'Scania', categories: ['trucks'], models: ['P-Series', 'G-Series', 'R-Series', 'S-Series'] },
  { id: 'man', name: 'مان', latin: 'MAN', categories: ['trucks'], models: ['TGX', 'TGS', 'TGM', 'TGL'] },
  { id: 'hino', name: 'هينو', latin: 'Hino', categories: ['trucks'], models: ['الفئة 300', 'الفئة 500', 'الفئة 700'] },
  { id: 'caterpillar', name: 'كاتربيلر', latin: 'Caterpillar CAT', categories: ['equipment'], models: ['حفار 320', 'حفار 330', 'شيول 950', 'شيول 966', 'بلدوزر D6', 'لودر 428'] },
  { id: 'komatsu', name: 'كوماتسو', latin: 'Komatsu', categories: ['equipment'], models: ['حفار PC200', 'حفار PC300', 'شيول WA380', 'بلدوزر D65'] },
  { id: 'jcb', name: 'جي سي بي', latin: 'JCB', categories: ['equipment'], models: ['3CX', '4CX', 'حفار JS', 'رافعة تلسكوبية Loadall'] },
];

export function normalizeVehicleSearch(value: string) {
  return value.normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase().trim();
}
export function findVehicleBrands(category: VehicleCategory, query: string) {
  const words = normalizeVehicleSearch(query).split(/\s+/).filter(Boolean);
  return VEHICLE_BRANDS.filter(b => (category === 'all' || b.categories.includes(category)) && words.every(w => normalizeVehicleSearch(`${b.name} ${b.latin}`).includes(w)));
}
export function vehicleCategory(value: unknown): VehicleCategory {
  return value === 'cars' || value === 'trucks' || value === 'equipment' ? value : 'all';
}
// Only year-scoped grades checked against Toyota KSA's official 2026 page.
export function vehicleTrimSuggestions(brand: string, model: string, year: string) {
  return brand === 'toyota' && model === 'كامري' && year === '2026'
    ? ['E', 'LE', 'Grande', 'E HEV', 'E Plus HEV', 'LE HEV', 'LE-S HEV', 'Lumiere HEV'] : [];
}
export interface VehicleRequest { brand: string; model: string; year: string; trim: string; engine?: string; part?: string; }
export function vehicleRequestText(input: VehicleRequest): string | null {
  const brand = VEHICLE_BRANDS.find(b => b.id === input.brand);
  const year = Number(input.year);
  if (!brand || !input.model.trim() || !input.trim.trim() || !/^\d{4}$/.test(input.year) || year < 1960 || year > new Date().getUTCFullYear() + 1) return null;
  const clean = (s: string, max: number) => s.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  return [`أبحث عن قطعة للمركبة: ${brand.name}، ${clean(input.model, 80)}، موديل ${input.year}، الفئة: ${clean(input.trim, 80)}.`, input.engine?.trim() ? `المحرك/ناقل الحركة: ${clean(input.engine, 80)}.` : '', input.part?.trim() ? `القطعة: ${clean(input.part, 160)}.` : 'أحتاج المساعدة في تحديد القطعة.'].filter(Boolean).join('\n');
}
