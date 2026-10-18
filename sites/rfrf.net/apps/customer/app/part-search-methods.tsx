'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, Hash, ScanLine, Search, ArrowLeft, X } from 'lucide-react';
import { partSearchIntake, type PartSearchMethod } from '../lib/part-search-intake';
import styles from './part-search-methods.module.css';

const METHODS = [{id:'vin',label:'رقم الهيكل',icon:ScanLine},{id:'image',label:'صورة القطعة',icon:Camera},{id:'name',label:'اسم القطعة',icon:Search},{id:'number',label:'رقم القطعة',icon:Hash}] as const;
export function PartSearchMethods({onApply,onPhoto,disabled=false,activeMethod=null,activationKey=0}: {onApply:(input:{text?:string;attachmentRequested?:boolean})=>void;onPhoto?:()=>void;disabled?:boolean;activeMethod?:PartSearchMethod|null;activationKey?:number}) {
  const [method,setMethod] = useState<PartSearchMethod|null>(activeMethod);
  const [value,setValue] = useState('');
  const [error,setError] = useState('');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(()=>{if(activeMethod){setMethod(activeMethod);setValue('');setError('');}},[activeMethod,activationKey]);
  useEffect(()=>{if(method)input.current?.focus();},[method]);
  const label = METHODS.find(m=>m.id===method)?.label;
  function apply() {
    if (!method || disabled) return;
    const result = partSearchIntake(method,value);
    if ('error' in result) { setError(result.error);input.current?.focus();return; }
    setError('');onApply({text:result.text});setMethod(null);setValue('');
  }
  return <section className={styles.methods} aria-label="طرق البحث عن القطعة">
    <div className={styles.buttons} role="group" aria-label="اختر طريقة البحث">{METHODS.map(({id:kind,label,icon:Icon})=><button key={kind} type="button" disabled={disabled} aria-pressed={method===kind} onClick={()=>{setError('');setValue('');if(kind==='image'){setMethod(null);if(onPhoto)onPhoto();else onApply({attachmentRequested:true});}else setMethod(kind);}}><Icon size={18} aria-hidden/>{label}</button>)}</div>
    {method&&<div className={styles.panel}>
      <div className={styles.panelTitle}><label htmlFor={id}>{label}{method==='vin'?' (VIN)':''}</label><button type="button" aria-label="إغلاق طريقة البحث" onClick={()=>{setMethod(null);setError('');}}><X size={18} aria-hidden/></button></div>
      <div className={styles.inputRow}><input id={id} ref={input} value={value} disabled={disabled} maxLength={method==='vin'?30:method==='number'?80:160} autoComplete="off" autoCapitalize={method==='vin'?'characters':'off'} spellCheck={false} dir={method==='name'?'rtl':'ltr'} placeholder={method==='vin'?'17 حرفًا ورقمًا':method==='number'?'رقم OEM أو رقم الشركة المصنعة':'مثل دينمو أو فحمات أمامية'} aria-invalid={Boolean(error)} aria-describedby={id+'-hint'+(error?' '+id+'-error':'')} onChange={e=>{setValue(e.target.value);setError('');}} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();apply();}}}/><button type="button" disabled={disabled} onClick={apply}>استخدم في المحادثة <ArrowLeft size={17} aria-hidden/></button></div>
      <p id={id+'-hint'}>{method==='vin'?'نضيف رقم الهيكل إلى طلبك للتحقق من المركبة؛ صحة الصيغة وحدها لا تثبت مطابقة القطعة.':method==='number'?'اكتب الرقم كما هو، مع الحروف والأصفار والفواصل. رقم الباركود قد يختلف عن رقم القطعة.':'يمكنك إضافة الماركة والموديل وسنة الصنع إلى وصفك لرفع الدقة.'}</p>
      {error&&<p className={styles.error} id={id+'-error'} role="alert">{error}</p>}
    </div>}
  </section>;
}
