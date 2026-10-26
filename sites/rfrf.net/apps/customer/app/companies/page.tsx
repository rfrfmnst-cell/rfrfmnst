import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "@rafraf/ui/brand-logo";
import { vehicleCategory } from "../../lib/vehicle-catalog";
import { SiteFooter } from "../site-footer";
import { VehicleFinder } from "./vehicle-finder";
import styles from "./companies.module.css";

export const metadata: Metadata = {
  title: "علامات المركبات وقطع الغيار — رفرف",
  description:
    "اختر علامة مركبتك ثم نوعها وسنة الصنع والفئة لتحديد طلب قطعة الغيار بدقة.",
  alternates: { canonical: "/companies" },
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const category = vehicleCategory((await searchParams).category);
  return (
    <>
      <main className={styles.page} id="main-content">
        <header className={styles.header}>
          <Link href="/" aria-label="رفرف — الرئيسية">
            <BrandLogo />
          </Link>
          <Link href="/">
            <ArrowRight size={18} aria-hidden /> الرئيسية
          </Link>
        </header>
        <section className={styles.intro} aria-labelledby="companies-title">
          <p className={styles.eyebrow}>قطعتك تبدأ من مركبتك</p>
          <h1 id="companies-title">
            اختر علامة مركبتك،
            <br />
            وحدد قطعتك بدقة.
          </h1>
          <p>
            تويوتا، هوندا، هيونداي وغيرها. ابدأ بالعلامة، ثم نوع المركبة والموديل
            والفئة، وأكمل طلبك مع مساعد رفرف.
          </p>
        </section>
        <VehicleFinder key={category} initialCategory={category} latestYear={new Date().getUTCFullYear() + 1} />
        <aside className={styles.help}>
          <div>
            <h2>عندك رقم قطعة أو صورة؟</h2>
            <p>ابدأ طلبك في رفرف وأضف تفاصيل المركبة لتوضيح احتياجك.</p>
          </div>
          <Link href="/chat">
            ابدأ طلب قطعة <ArrowRight size={18} aria-hidden />
          </Link>
        </aside>
        <p className={styles.note}>
          العلامات للتعريف بالمركبة. الاختيار لا يثبت توفر القطعة أو توافقها؛ نراجع
          تفاصيل المركبة ورقم القطعة قبل اعتماد الطلب.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
