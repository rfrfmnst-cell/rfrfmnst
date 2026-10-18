'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CarFront, Check, Search, Tractor, Truck, X } from 'lucide-react';
import { findVehicleBrands, VEHICLE_BRANDS, vehicleRequestText, vehicleTrimSuggestions, type VehicleCategory } from '../../lib/vehicle-catalog';
import { storeChatEntryDraft } from '../../lib/chat-entry-draft';
import styles from './vehicle-finder.module.css';

const FILTERS = [{id:'all',label:'كل العلامات',icon:CarFront},{id:'cars',label:'سيارات',icon:CarFront},{id:'trucks',label:'شاحنات',icon:Truck},{id:'equipment',label:'معدات',icon:Tractor}] as const;
const LOGOS = new Set(['toyota','honda','hyundai','nissan','kia','ford','chevrolet','mazda','mitsubishi','suzuki','bmw','audi','volkswagen','volvo','scania','man','caterpillar','mg']);

export function VehicleFinder({ initialCategory, latestYear }: {initialCategory: VehicleCategory; latestYear: number}) {
  const [category,setCategory] = useState(initialCategory);
  const [chineseOnly,setChineseOnly] = useState(false);
  const [query,setQuery] = useState('');
  const [brandId,setBrandId] = useState('');
  const [model,setModel] = useState('');
  const [manualModel,setManualModel] = useState('');
  const [year,setYear] = useState('');
  const [trim,setTrim] = useState('');
  const [unknownTrim,setUnknownTrim] = useState(false);
  const [engine,setEngine] = useState('');
  const [part,setPart] = useState('');
  const [error,setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const brand = VEHICLE_BRANDS.find(b=>b.id===brandId);
  const selectedModel = model === 'other' ? manualModel.trim() : model;
  const brands = findVehicleBrands(category,query,chineseOnly);
  const grades = vehicleTrimSuggestions(brandId,selectedModel,year);
  const ready = Boolean(brand && selectedModel && year && (trim.trim() || unknownTrim));

  function resetAfterBrand(id: string) {
    setBrandId(id); setModel(''); setManualModel(''); setYear(''); setTrim(''); setUnknownTrim(false); setEngine(''); setError('');
    requestAnimationFrame(()=>{ heading.current?.focus(); heading.current?.scrollIntoView({block:'center',behavior:'instant'}); });
  }
  function continueRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const text = vehicleRequestText({brand:brandId,model:selectedModel,year,trim:unknownTrim?'غير معروفة — أحتاج المساعدة في تحديدها':trim,engine,part});
    if (!text) { setError('أكمل اختيار المركبة وسنة الصنع والفئة أولًا.'); return; }
    let saved = false;
    try { saved = storeChatEntryDraft(window.sessionStorage,{text}); } catch { /* Storage access can be denied. */ }
    if (!saved) { setError('تعذر حفظ تفاصيل مركبتك مؤقتًا. فعّل تخزين الجلسة ثم حاول مجددًا.'); return; }
    window.location.assign('/chat');
  }

  return <section className={styles.finder} aria-label="اختيار المركبة لطلب قطع الغيار">
    <ol className={styles.steps} aria-label="خطوات تحديد المركبة">
      {['العلامة','نوع المركبة','الموديل','الفئة'].map((label,index)=><li key={label} aria-current={index===(brand?selectedModel?year?3:2:1:0)?'step':undefined}><span>{index+1}</span>{label}</li>)}
    </ol>
    {!brand ? <>
      <div className={styles.filters}>
        <div className={styles.categories} role="group" aria-label="مجال المركبة">{FILTERS.map(({id,label,icon:Icon})=><button key={id} type="button" aria-pressed={category===id} onClick={()=>setCategory(id)}><Icon size={18} aria-hidden/>{label}</button>)}<button type="button" aria-pressed={chineseOnly} onClick={()=>setChineseOnly(!chineseOnly)}>العلامات الصينية</button></div>
        <label className={styles.search}><Search size={20} aria-hidden/><span className="sr-only">ابحث عن علامة المركبة</span><input type="search" value={query} maxLength={80} onChange={e=>setQuery(e.target.value)} placeholder="تويوتا، شانجان، جيلي، BYD…"/>{query&&<button type="button" aria-label="مسح البحث" onClick={()=>setQuery('')}><X size={18} aria-hidden/></button>}</label>
      </div>
      <p className={styles.count} role="status">{brands.length} علامة متاحة للاختيار</p>
      {brands.length ? <ul className={styles.brandGrid}>{brands.map(b=><li key={b.id}><button type="button" className={styles.brandCard} aria-label={`اختيار ${b.name}`} onClick={()=>resetAfterBrand(b.id)}>
        {LOGOS.has(b.id)?<img src={`/vehicle-brands/${b.id}.svg`} width="88" height="58" alt="" loading="lazy"/>:<span className={styles.wordmark} aria-hidden dir="ltr">{b.latin}</span>}
        <strong>{b.name}</strong><span dir="ltr">{b.latin}</span><ArrowLeft size={17} aria-hidden/>
      </button></li>)}</ul> : <div className={styles.empty}><Search size={32} aria-hidden/><h2>لم نجد علامة بهذا البحث</h2><p>جرّب الاسم بالعربية أو الإنجليزية.</p><button type="button" onClick={()=>{setQuery('');setCategory('all');setChineseOnly(false);}}>عرض كل العلامات</button></div>}
    </> : <div className={styles.selection}>
      <div className={styles.selectedBrand}><div><span className={styles.check}><Check size={20} aria-hidden/></span><strong>{brand.name}</strong><span dir="ltr">{brand.latin}</span></div><button type="button" onClick={()=>resetAfterBrand('')}><ArrowRight size={17} aria-hidden/>تغيير العلامة</button></div>
      <h2 ref={heading} tabIndex={-1}>حدد مركبتك بدقة</h2><p className={styles.hint}>اختر التفاصيل كما هي في وثائق المركبة. يمكنك كتابة الطراز أو الفئة إذا لم يظهر في القائمة.</p>
      <form onSubmit={continueRequest}>
        <div className={styles.fields}>
          <label><span>نوع المركبة (الطراز)</span><select aria-label="نوع المركبة (الطراز)" required value={model} onChange={e=>{setModel(e.target.value);setManualModel('');setYear('');setTrim('');setUnknownTrim(false);setEngine('');}}><option value="">اختر نوع المركبة</option>{brand.models.map(m=><option key={m}>{m}</option>)}<option value="other">طراز آخر — إدخال يدوي</option></select></label>
          {model==='other'&&<label><span>اسم الطراز</span><input required value={manualModel} maxLength={80} onChange={e=>{setManualModel(e.target.value);setYear('');setTrim('');setUnknownTrim(false);}} placeholder="كما هو مكتوب على المركبة"/></label>}
          <label><span>الموديل (سنة الصنع)</span><select aria-label="الموديل (سنة الصنع)" required disabled={!selectedModel} value={year} onChange={e=>{setYear(e.target.value);setTrim('');setUnknownTrim(false);setEngine('');}}><option value="">اختر سنة الصنع</option>{Array.from({length:latestYear-1959},(_,i)=>latestYear-i).map(y=><option key={y} value={y}>{y}</option>)}</select></label>
          <label><span>الفئة</span><input disabled={!year||unknownTrim} required={!unknownTrim} list="vehicle-trim-options" value={trim} maxLength={80} onChange={e=>setTrim(e.target.value)} placeholder={grades.length?'اختر أو اكتب الفئة، مثل LE':'اكتب الفئة كما هي على المركبة'}/><datalist id="vehicle-trim-options">{grades.map(g=><option key={g} value={g}/>)}</datalist></label>
          <label className={styles.unknown}><input type="checkbox" disabled={!year} checked={unknownTrim} onChange={e=>{setUnknownTrim(e.target.checked);setTrim('');}}/>لا أعرف الفئة — ساعدني في تحديدها</label>
          <label><span>المحرك وناقل الحركة <small>(اختياري)</small></span><input disabled={!year} value={engine} maxLength={80} onChange={e=>setEngine(e.target.value)} placeholder="مثل 2.5 لتر، بنزين، أوتوماتيك"/></label>
          <label className={styles.part}><span>اسم القطعة أو رقمها <small>(اختياري)</small></span><input value={part} maxLength={160} onChange={e=>setPart(e.target.value)} placeholder="مثل دينمو، فلتر زيت، أو رقم القطعة"/></label>
        </div>
        {ready&&<div className={styles.summary} role="status"><CarFront size={23} aria-hidden/><span>{brand.name} · {selectedModel} · <bdi>{year}</bdi> · {unknownTrim?'الفئة تحتاج تحديدًا':trim}</span></div>}
        <p className={styles.hint}>هذه البيانات تساعد في تحديد القطعة؛ تؤكد المطابقة النهائية برقم الهيكل أو رقم القطعة، وقد تختلف الفئات باختلاف سنة الصنع والسوق.</p>
        {error&&<p className={styles.error} role="alert">{error}</p>}
        <button className={styles.continue} disabled={!ready}>متابعة إلى مساعد رفرف <ArrowLeft size={20} aria-hidden/></button>
      </form>
    </div>}
  </section>;
}
