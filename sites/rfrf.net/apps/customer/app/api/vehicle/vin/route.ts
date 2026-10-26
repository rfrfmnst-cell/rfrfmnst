import { createHash, randomBytes } from 'node:crypto';
import { lookupVehicleVin } from '../../../../lib/vin-lookup';
import { normalizeVin } from '../../../../lib/vin';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const salt=randomBytes(32).toString('hex');
const callers=new Map<string,{count:number;expires:number}>();
let globalWindow={count:0,expires:0};
const headers={'Cache-Control':'no-store, max-age=0'};

export async function POST(request:Request) {
  const origin=request.headers.get('origin');
  if (request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==new URL(request.url).origin&&origin!=='https://rfrf.net'))return Response.json({error:'forbidden'},{status:403,headers});
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return Response.json({error:'invalid_request'},{status:415,headers});
  const size=Number(request.headers.get('content-length')??0);
  if(size>512)return Response.json({error:'invalid_request'},{status:413,headers});
  // Count all attempts before parsing. Limits are per process plus a global cap;
  // they do not replace the durable guards protecting account authentication.
  const now=Date.now();
  for(const [key,bucket]of callers)if(bucket.expires<=now)callers.delete(key);
  if(globalWindow.expires<=now)globalWindow={count:0,expires:now+60000};
  const address=(request.headers.get('x-forwarded-for')?.split(',')[0]??request.headers.get('x-real-ip')??'unknown').trim().slice(0,100);
  const key=createHash('sha256').update(salt+address).digest('hex');
  const bucket=callers.get(key)??{count:0,expires:now+60000};
  if(bucket.count>=4||globalWindow.count>=20||callers.size>=128&&!callers.has(key))return Response.json({error:'rate_limited'},{status:429,headers:{...headers,'Retry-After':'60'}});
  bucket.count++;globalWindow.count++;callers.set(key,bucket);
  let raw:string;
  const reader=request.body?.getReader();
  if(!reader)return Response.json({error:'invalid_request'},{status:400,headers});
  let timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},3000);
  try {
    const chunks:Uint8Array[]=[];let total=0;
    for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>512){await reader.cancel();return Response.json({error:'invalid_request'},{status:413,headers});}chunks.push(value);}
    if(timedOut)return Response.json({error:'invalid_request'},{status:408,headers});
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}raw=new TextDecoder().decode(bytes);
  } catch {return Response.json({error:'invalid_request'},{status:400,headers});}
  finally {clearTimeout(timeout);}
  let value:unknown;try{value=JSON.parse(raw);}catch{return Response.json({error:'invalid_request'},{status:400,headers});}
  const vin=normalizeVin(value&&typeof value==='object'&&'vin'in value&&typeof value.vin==='string'?value.vin:'');
  if(!vin)return Response.json({error:'invalid_vin'},{status:400,headers});
  const result=await lookupVehicleVin(vin);
  return Response.json(result,{status:result.status==='unavailable'?503:200,headers});
}
