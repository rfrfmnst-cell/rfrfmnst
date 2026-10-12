import {
  ArrowLeft,
  BadgeCheck,
  CircleDollarSign,
  PackageCheck,
  SearchCheck,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { SUPPLIER_REGISTRATION_URL } from '../lib/public-app-urls';
import { PrecisionHero } from './precision-hero';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const STEPS = [
  {
    icon: SearchCheck,
    title: 'صف احتياجك',
    text: 'اكتب اسم القطعة، صوّرها، أو أدخل VIN / OEM داخل المحادثة.',
  },
  {
    icon: ShieldCheck,
    title: 'تحقق من المطابقة',
    text: 'نربط المركبة بالقطعة ونوقف أي نتيجة لا تصل إلى مستوى الثقة المطلوب.',
  },
  {
    icon: PackageCheck,
    title: 'اختر العرض المناسب',
    text: 'قارن السعر النهائي ومدة التجهيز والضمان ثم وافق بنفسك.',
  },
] as const;

const FAQ = [
  [
    'كيف أعرف أن القطعة تناسب سيارتي؟',
    'نعتمد على هوية المركبة ورقم OEM ومصدر التوافق. النتيجة غير المؤكدة تنتقل إلى مراجعة بشرية ولا تظهر كعرض جاهز.',
  ],
  [
    'هل ينشئ المساعد طلباً دون موافقتي؟',
    'لا. إنشاء طلب التوريد واعتماد العرض عمليتان تحتاجان موافقة صريحة داخل المحادثة.',
  ],
  [
    'هل السعر المعروض نهائي؟',
    'توضح المقارنة سعر القطعة والشحن والضريبة قبل اعتماد العرض، ولا نضيف أرقاماً أو وعوداً غير موثقة.',
  ],
] as const;

/**
 * لقطة الهيرو السعودية اختيارية وتُقرأ من بيئة الخادم فقط: مسار نسبي داخل
 * public/ أو رابط https. أي قيمة أخرى تُتجاهل وتبقى الصورة الثابتة.
 */
function heroVideoSource(): string | undefined {
  const raw = process.env.RAFRAF_HERO_VIDEO_SRC?.trim();
  if (!raw) return undefined;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    return new URL(raw).protocol === 'https:' ? raw : undefined;
  } catch {
    return undefined;
  }
}

export default function Home() {
  return (
    <>
      <main className="precision-home">
        <PrecisionHero videoSrc={heroVideoSource()} />

        <section id="how" className="precision-section precision-how">
          <div className="precision-container">
            <p className="precision-kicker">رحلة واضحة من أول رسالة</p>
            <div className="precision-heading-row">
              <h2>ثلاث خطوات، وكل قرار ظاهر لك</h2>
              <p>بلا نماذج طويلة، وبلا إنشاء طلب قبل التوثيق والموافقة.</p>
            </div>
            <ol className="precision-steps">
              {STEPS.map(({ icon: Icon, title, text }, index) => (
                <li key={title}>
                  <span className="precision-step-index">0{index + 1}</span>
                  <Icon aria-hidden />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="precision-section precision-trust">
          <div className="precision-container precision-trust-grid">
            <div>
              <p className="precision-kicker">الثقة مبنية داخل الرحلة</p>
              <h2>مطابقة، دفع، وشحن ضمن سياق واحد</h2>
              <p>
                يحتفظ رفرف بسجل المحادثة والموافقات ويربط العرض المختار بالطلب
                الصحيح؛ بدون إظهار بيانات العميل للمورد أو خلط عروض الطلبات.
              </p>
              <Link className="precision-link" href="/chat">
                ابدأ طلباً موثقاً <ArrowLeft size={18} aria-hidden />
              </Link>
            </div>
            <ul>
              <li>
                <BadgeCheck aria-hidden />
                <span>
                  <strong>توافق موثّق</strong>لا يظهر العرض كمتوافق قبل اجتياز
                  سياسة المطابقة.
                </span>
              </li>
              <li>
                <CircleDollarSign aria-hidden />
                <span>
                  <strong>موافقة قبل الشراء</strong>اعتماد العرض خطوة صريحة
                  مرتبطة بحساب العميل.
                </span>
              </li>
              <li>
                <Truck aria-hidden />
                <span>
                  <strong>تتبّع مستمر</strong>كل حالة تنفيذ موثقة من الطلب حتى
                  التسليم.
                </span>
              </li>
            </ul>
          </div>
        </section>

        <section className="precision-section precision-faq">
          <div className="precision-container precision-faq-grid">
            <div>
              <p className="precision-kicker">أسئلة مباشرة</p>
              <h2>قبل أن تبدأ</h2>
            </div>
            <div className="precision-questions">
              {FAQ.map(([question, answer]) => (
                <details key={question}>
                  <summary>{question}</summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="supplier" className="precision-supplier">
          <div className="precision-container">
            <div>
              <p className="precision-kicker">للموردين المعتمدين</p>
              <h2>فرص واضحة، وبيانات عميل محمية</h2>
            </div>
            <a href={SUPPLIER_REGISTRATION_URL}>
              ابدأ التأهيل <ArrowLeft size={18} aria-hidden />
            </a>
          </div>
        </section>
      </main>
      <footer className="precision-footer">
        <div className="precision-container">
          <p>رفرف — قطع غيار بقرار موثّق</p>
          <nav aria-label="روابط التذييل">
            <Link href="/privacy">سياسة الخصوصية</Link>
            <Link href="/track">تتبع طلبك</Link>
            <a href={SUPPLIER_REGISTRATION_URL}>بوابة الموردين</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
