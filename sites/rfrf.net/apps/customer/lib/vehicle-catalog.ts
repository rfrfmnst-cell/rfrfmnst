export type VehicleCategory = 'all' | 'cars' | 'trucks' | 'equipment';
export interface VehicleBrand { id: string; name: string; latin: string; categories: VehicleCategory[]; models: string[]; aliases?: string[]; chineseBrand?: boolean; }

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
  // Chinese and Chinese-owned marques with documented Saudi market presence.
  {"id":"changan","name":"شانجان","latin":"Changan","models":["السفن","إيدو بلس","CS35 Plus","CS55 Plus","CS75 Plus","CS95","UNI-T","UNI-K","UNI-V","UNI-S"],"aliases":["تشانجان","شانغان"],"chineseBrand":true,"categories":["cars"]},
  {"id":"geely","name":"جيلي","latin":"Geely","models":["إمجراند","كولراي","مونجارو","أوكافانجو","ستار راي","بريفيس","سيتي راي","توجيلا","Geometry C"],"aliases":["جيلى","جيلي الوعلان"],"chineseBrand":true,"categories":["cars"]},
  {"id":"chery","name":"شيري","latin":"Chery","models":["أريزو 5 برو","أريزو 6 برو","أريزو 8 برو","تيجو 2 برو","تيجو 4 برو","تيجو 7 برو ماكس","تيجو 8 برو ماكس","تيجو 9"],"aliases":["شيرى","تشيري"],"chineseBrand":true,"categories":["cars"]},
  {"id":"mg","name":"إم جي","latin":"MG","models":["MG 3","MG 5","MG 6","MG 7","MG GT","MG ZS","MG HS","MG RX5","MG RX8","MG ONE"],"aliases":["امجي","ام جي","إمجي"],"chineseBrand":true,"categories":["cars"]},
  {"id":"haval","name":"هافال","latin":"Haval","models":["H6","H6 GT","H9","جوليان","جوليان برو","دارجو"],"aliases":["هافل"],"chineseBrand":true,"categories":["cars"]},
  {"id":"gwm","name":"جريت وول","latin":"GWM Great Wall","models":["وينجل 5","وينجل 7","باور POER"],"aliases":["جريتول","جريت وال","غريت وول","وينجل","باور"],"chineseBrand":true,"categories":["cars","trucks"]},
  {"id":"tank","name":"تانك","latin":"TANK","models":["300","500","700"],"aliases":["تنك"],"chineseBrand":true,"categories":["cars"]},
  {"id":"gac","name":"جي أيه سي","latin":"GAC Motor","models":["إمباو","إمزووم","إمكو","GS3","GS4","GS8","GA4","GA6","GN6","M8"],"aliases":["جي ايه سي","جي إيه سي","جي اي سي","جي إيه سي موتور"],"chineseBrand":true,"categories":["cars"]},
  {"id":"baic","name":"بايك","latin":"BAIC","models":["BJ30","BJ40","BJ40 Pro","BJ60","BJ80","X35","X55","X7","X75","U5 Plus","D50"],"aliases":["بايك موتور","بي ايه اي سي"],"chineseBrand":true,"categories":["cars"]},
  {"id":"jac","name":"جاك","latin":"JAC","models":["JS3","JS4","JS6","T8","T9"],"aliases":["جاك موتور"],"chineseBrand":true,"categories":["cars","trucks"]},
  {"id":"jetour","name":"جيتور","latin":"Jetour","models":["T1","T2","داشينج","X50","X70","X70 Plus","X90 Plus"],"aliases":["جتور","جيتور الوعلان"],"chineseBrand":true,"categories":["cars"]},
  {"id":"exeed","name":"إكسيد","latin":"EXEED","models":["LX","TXL","VX","RX"],"aliases":["اكسيد","إكسييد"],"chineseBrand":true,"categories":["cars"]},
  {"id":"omoda","name":"أومودا","latin":"OMODA","models":["C5","C7","E5"],"aliases":["اومودا","أمودا"],"chineseBrand":true,"categories":["cars"]},
  {"id":"jaecoo","name":"جايكو","latin":"JAECOO","models":["J5","J7","J8"],"aliases":["جيكو","جايكوا"],"chineseBrand":true,"categories":["cars"]},
  {"id":"hongqi","name":"هونشي","latin":"Hongqi","models":["H5","H9","HS3","HS5","HS7","أوسادو","E-HS9"],"aliases":["هونغ تشي","هونج تشي","هونقي"],"chineseBrand":true,"categories":["cars"]},
  {"id":"bestune","name":"بستيون","latin":"Bestune","models":["B70","B70S","T33","T77","T90","T99"],"aliases":["بستون","بيستون","بستيون"],"chineseBrand":true,"categories":["cars"]},
  {"id":"byd","name":"بي واي دي","latin":"BYD","models":["ATTO 3","SEAL","SONG PLUS","QIN PLUS","HAN","SHARK 6"],"aliases":["بيوايدي","بى واى دى","بي واي دي"],"chineseBrand":true,"categories":["cars"]},
  {"id":"denza","name":"دينزا","latin":"DENZA","models":["B5","B8"],"aliases":["دنزا"],"chineseBrand":true,"categories":["cars"]},
  {"id":"zeekr","name":"زيكر","latin":"ZEEKR","models":["001","X","7X"],"aliases":["زيكير"],"chineseBrand":true,"categories":["cars"]},
  {"id":"lynkco","name":"لينك آند كو","latin":"Lynk & Co","models":["01","02","03","03+","05","06","09"],"aliases":["لينك اند كو","لينك أند كو","لينككو","لينك وكو","lynkco"],"chineseBrand":true,"categories":["cars"]},
  {"id":"deepal","name":"ديبال","latin":"DEEPAL","models":["S05","S07","S09","G318"],"aliases":["ديبل"],"chineseBrand":true,"categories":["cars"]},
  {"id":"rox","name":"روكس","latin":"ROX","models":["01","أداماس"],"aliases":["روكس موتورز","روكس موتور"],"chineseBrand":true,"categories":["cars"]},
  {"id":"soueast","name":"سوايست","latin":"SOUEAST","models":["S06","S07","S08","S09"],"aliases":["سوايست","سوإيست","سو ايست","ساوايست","سويست"],"chineseBrand":true,"categories":["cars"]},
  {"id":"kaiyi","name":"كايي","latin":"KAIYI","models":["X3","X3 Pro","X7","E5"],"aliases":["كاي يي","كايى"],"chineseBrand":true,"categories":["cars"]},
  {"id":"forthing","name":"فورثينج","latin":"Forthing","models":["T5 EVO","U-Tour","Friday T5","S7"],"aliases":["فورثنج","فورثينغ","فورثنغ"],"chineseBrand":true,"categories":["cars"]},
  {"id":"dongfeng","name":"دونغ فينغ","latin":"Dongfeng","models":["شاين","شاين ماكس","ميج MAGE","AX7 MACH","HUGE","007","Captain","Dollicar"],"aliases":["دونج فينج","دونج فنج","دونغفينغ","دونجفينج","دونغ فنغ","DFM"],"chineseBrand":true,"categories":["cars","trucks"]},
  {"id":"maxus","name":"ماكسوس","latin":"Maxus","models":["D60","D90","D90 Pro","G50","G50 Plus","G70","G90","تورنيدو 60","تورنيدو 70","تورنيدو 90","V80","V90"],"aliases":["ماكسس","ماكسيوس","ماكسيس"],"chineseBrand":true,"categories":["cars","trucks"]},
  {"id":"skyworth","name":"سكاي وورث","latin":"Skyworth / Skywell","models":["K","K-i","ET5"],"aliases":["سكاي ويل","سكايورث","سكاي وورث","skywell"],"chineseBrand":true,"categories":["cars"]},
  {"id":"vgv","name":"في جي في","latin":"VGV","models":["U70 Pro","U75 Plus","بولدن"],"aliases":["ڤي جي ڤي","فيجي في"],"chineseBrand":true,"categories":["cars"]},
  {"id":"jmc","name":"جي إم سي الصينية","latin":"JMC","models":["فيجاس Vigus","Grand Avenue","Carrying","Touring"],"aliases":["جي ام سي الصينية","جيه ام سي","جي إم سي جيمسي الصينية"],"chineseBrand":true,"categories":["cars","trucks"]},
  {"id":"voyah","name":"فوياه","latin":"VOYAH","models":["FREE","DREAM","PASSION"],"aliases":["فويا","فويـاه"],"chineseBrand":true,"categories":["cars"]},
  {"id":"mhero","name":"إم هيرو","latin":"MHERO","models":["I"],"aliases":["ام هيرو","إمهيرو","امهيرو","M-Hero"],"chineseBrand":true,"categories":["cars"]},
  {"id":"aion","name":"آيون","latin":"AION","models":["ES","V"],"aliases":["ايون","أيون"],"chineseBrand":true,"categories":["cars"]},
  {"id":"hyptec","name":"هايبتك","latin":"HYPTEC","models":["HT"],"aliases":["هايبتيك","هايبتك","هايبر","Hyper"],"chineseBrand":true,"categories":["cars"]},
  {"id":"foton","name":"فوتون","latin":"Foton","models":["تونلاند G7","Aumark","Auman","View","Toano"],"aliases":["فوتن"],"chineseBrand":true,"categories":["trucks"]},
  {"id":"sinotruk","name":"سينوتراك","latin":"SINOTRUK","models":["HOWO","SITRAK","MAX"],"aliases":["سينوترك","سينوتروك","هاو","هوو","HOWO","SITRAK"],"chineseBrand":true,"categories":["trucks"]},
  {"id":"shacman","name":"شاكمان","latin":"Shacman","models":["F2000","F3000","X3000","X5000","X6000"],"aliases":["شكمان","شاك مان","شانكسي","شانشي","Shaanxi"],"chineseBrand":true,"categories":["trucks"]},
  {"id":"faw","name":"فاو","latin":"FAW Jiefang","models":["J6","JH6","J7"],"aliases":["فاو جيفانج","فاو جي فانغ"],"chineseBrand":true,"categories":["trucks"]},
  {"id":"sany","name":"ساني","latin":"SANY","models":["حفار","رافعة","مضخة خرسانة","معدات طرق"],"aliases":["صاني"],"chineseBrand":true,"categories":["equipment"]},
  {"id":"xcmg","name":"إكس سي إم جي","latin":"XCMG","models":["حفار","شيول","رافعة","قريدر"],"aliases":["اكس سي ام جي","اكس سي إم جي","اكسجم"],"chineseBrand":true,"categories":["equipment"]},
  {"id":"liugong","name":"ليوغونغ","latin":"LiuGong","models":["حفار","شيول","قريدر","مدحلة"],"aliases":["ليوجونج","ليوغونج","ليو جونج","ليو غونغ"],"chineseBrand":true,"categories":["equipment"]},
  {"id":"zoomlion","name":"زومليون","latin":"Zoomlion","models":["حفار","شيول","رافعة","مضخة خرسانة","رافعة شوكية"],"aliases":["زوم ليون"],"chineseBrand":true,"categories":["equipment"]},
  {"id":"shantui","name":"شانتوي","latin":"Shantui","models":["بلدوزر","شيول","قريدر","مدحلة"],"aliases":["شانتوى","شانتوي"],"chineseBrand":true,"categories":["equipment"]},
  {"id":"sdlg","name":"إس دي إل جي","latin":"SDLG","models":["شيول","حفار","قريدر","مدحلة"],"aliases":["اس دي ال جي","اس دي إل جي","لينغونغ"],"chineseBrand":true,"categories":["equipment"]},
  // Parallel-import makes evidenced by a Saudi specialist service centre.
  {"id":"xpeng","name":"إكس بنغ","latin":"XPENG","models":["G6","G9","P7","X9"],"aliases":["اكس بنغ","إكسبنج","اكس بينج","إكس بنج"],"chineseBrand":true,"categories":["cars"]},
  {"id":"li-auto","name":"لي أوتو","latin":"Li Auto / LiXiang","models":["L6","L7","L8","L9","MEGA"],"aliases":["لي اوتو","لي أوتو","لي شيانغ","ليشيانغ","لي اكس يانج","lixiang"],"chineseBrand":true,"categories":["cars"]},
  {"id":"nio","name":"نيو","latin":"NIO","models":["ET7"],"aliases":["نيو الكهربائية"],"chineseBrand":true,"categories":["cars"]},
  {"id":"avatr","name":"أفاتر","latin":"AVATR","models":["11","12","07"],"aliases":["افاتار","أفاتار","افاتر","أفاتر"],"chineseBrand":true,"categories":["cars"]},
  {"id":"aito","name":"أيتو","latin":"AITO","models":[],"aliases":["ايتو","آيتو"],"chineseBrand":true,"categories":["cars"]},
  {"id":"xiaomi","name":"شاومي","latin":"Xiaomi","models":[],"aliases":["شياومي","شاومى"],"chineseBrand":true,"categories":["cars"]},
];

export function normalizeVehicleSearch(value: string) {
  return value.normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase().trim();
}
export function findVehicleBrands(category: VehicleCategory, query: string, chineseOnly = false) {
  const words = normalizeVehicleSearch(query).split(/\s+/).filter(Boolean);
  return VEHICLE_BRANDS.filter(b => (category === 'all' || b.categories.includes(category)) && (!chineseOnly || b.chineseBrand === true) && words.every(w => normalizeVehicleSearch(`${b.name} ${b.latin} ${b.aliases?.join(" ") ?? ""}`).includes(w)));
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
