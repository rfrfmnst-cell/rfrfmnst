import { normalizeVin } from './vin';

export interface DecodedVehicle { make:string; model:string; year:string; trim:string; engine:string; }
export type VinLookupResult = {status:'decoded'|'partial';vehicle:DecodedVehicle;source:'NHTSA vPIC'} | {status:'invalid'|'not_found'|'unavailable'};
function removeControlCharacters(value: string): string {
  return Array.from(value, (character) =>
    character.charCodeAt(0) <= 0x1f ? ' ' : character,
  )
    .join('')
    .trim()
    .slice(0, 80);
}

export async function lookupVehicleVin(raw:string, fetcher:typeof fetch=fetch):Promise<VinLookupResult> {
  const vin = normalizeVin(raw);
  if (!vin) return {status:'invalid'};
  try {
    const response = await fetcher(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,{signal:AbortSignal.timeout(7000),redirect:'error',cache:'no-store',headers:{Accept:'application/json'}});
    if (!response.ok) return {status:'unavailable'};
    // Bound the upstream response; never log the submitted VIN or return raw data.
    const reader = response.body?.getReader();
    if (!reader) return {status:'unavailable'};
    const chunks:Uint8Array[]=[];let size=0;
    for (;;) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();return {status:'unavailable'};}chunks.push(value); }
    const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
    const json=JSON.parse(new TextDecoder().decode(joined));
    const row=json?.Results?.[0];if(!row||typeof row!=='object')return {status:'not_found'};
    const clean=(value:unknown)=>typeof value==='string'?removeControlCharacters(value):'';
    const year=clean(row.ModelYear);
    const vehicle={make:clean(row.Make),model:clean(row.Model),year:/^\d{4}$/.test(year)?year:'',trim:clean(row.Trim),engine:[clean(row.DisplacementL),clean(row.FuelTypePrimary),clean(row.EngineModel)].filter(Boolean).join(' · ').slice(0,120)};
    if (!vehicle.make || !vehicle.model) return {status:'not_found'};
    return {status:clean(row.ErrorCode)==='0'&&vehicle.year?'decoded':'partial',vehicle,source:'NHTSA vPIC'};
  } catch { return {status:'unavailable'}; }
}
