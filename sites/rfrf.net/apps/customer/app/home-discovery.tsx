import Link from "next/link";
import {
  ArrowUpLeft,
  Building2,
  CarFront,
  MessageSquareText,
  PackageSearch,
  Tractor,
  Truck,
} from "lucide-react";
import styles from "./home-discovery.module.css";

const CATEGORIES = [
  {
    id: "cars",
    title: "قطع غيار السيارات",
    text: "للسيارات والمركبات الخفيفة",
    icon: CarFront,
  },
  {
    id: "trucks",
    title: "قطع غيار الشاحنات",
    text: "للنقل والمركبات التجارية",
    icon: Truck,
  },
  {
    id: "equipment",
    title: "قطع غيار المعدات",
    text: "للمعدات الثقيلة ومعدات الإنشاء",
    icon: Tractor,
  },
];

export function HomeDiscovery() {
  return (
    <section className={styles.section} aria-labelledby="discover-title">
      <div className={styles.container}>
        <nav className={styles.shortcuts} aria-label="خدمات العميل">
          <Link href="/chat">
            <MessageSquareText size={22} aria-hidden />
            <span>ابدأ طلب قطعة</span>
            <ArrowUpLeft size={18} aria-hidden />
          </Link>
          <Link href="/companies">
            <Building2 size={22} aria-hidden />
            <span>شركات قطع الغيار</span>
            <ArrowUpLeft size={18} aria-hidden />
          </Link>
          <Link href="/track">
            <PackageSearch size={22} aria-hidden />
            <span>تتبّع طلبك</span>
            <ArrowUpLeft size={18} aria-hidden />
          </Link>
        </nav>
        <div className={styles.heading}>
          <div>
            <p>من السيارات إلى المعدات</p>
            <h2 id="discover-title">اعرف وجهتك، وابدأ باحتياجك.</h2>
          </div>
          <Link href="/companies">
            كل الشركات <ArrowUpLeft size={18} aria-hidden />
          </Link>
        </div>
        <div className={styles.categories}>
          {CATEGORIES.map(({ id, title, text, icon: Icon }) => (
            <Link key={id} href={`/companies?category=${id}`}>
              <span className={styles.icon}>
                <Icon size={34} strokeWidth={1.5} aria-hidden />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className={styles.explore}>
                استكشف الشركات <ArrowUpLeft size={17} aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
