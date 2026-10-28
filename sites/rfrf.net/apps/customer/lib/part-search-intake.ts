import { normalizeVin } from './vin';

export type PartSearchMethod = 'vin' | 'name' | 'number';
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) <= 0x1f) return true;
  }
  return false;
}

export function partSearchIntake(method: PartSearchMethod, raw: string): {text: string} | {error: string} {
  const value = raw.trim();
  if (method === 'vin') {
    const vin = normalizeVin(value);
    return vin ? {text:`رقم الهيكل (VIN): ${vin}. أريد المساعدة في تحديد قطع الغيار لهذه المركبة.`} : {error:'رقم الهيكل يجب أن يتكون من 17 حرفًا ورقمًا، ولا يحتوي I أو O أو Q.'};
  }
  if (!value || value.length > (method === 'number' ? 80 : 160) || hasControlCharacters(value)) return {error:method==='number'?'أدخل رقم القطعة كما هو على القطعة أو عبوتها، بحد أقصى 80 خانة.':'أدخل اسم القطعة أو وصفًا واضحًا، بحد أقصى 160 حرفًا.'};
  return {text:method==='number'?`أبحث عن قطعة برقم القطعة الذي أكتبه: ${value}. ساعدني في التحقق من القطعة والمركبة المناسبة.`:`أبحث عن قطعة: ${value}. ساعدني في تحديد المواصفات المطلوبة.`};
}
