import { BrandLogo } from "@rafraf/ui/brand-logo";
import { ArrowUpLeft, Instagram, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { PUBLIC_CONTACT } from "../lib/public-contact";
import { SUPPLIER_REGISTRATION_URL } from "../lib/public-app-urls";
import styles from "./site-footer.module.css";

const NAVIGATION = [
  { href: "/companies", label: "علامات المركبات" },
  { href: "/chat", label: "ابدأ طلب قطعة" },
  { href: "/track", label: "تتبّع طلبك" },
  { href: "/account", label: "حسابك وطلباتك" },
  { href: "/privacy", label: "سياسة الخصوصية" },
] as const;

/** Pending profiles are deliberately static: no invented URLs or empty links. */
function PendingSocialProfiles() {
  return (
    <div className={styles.socialProfiles}>
      <p className={styles.socialLabel}>رفرف على منصات التواصل</p>
      <ul className={styles.socialIcons} aria-label="أيقونات حسابات التواصل">
        <li>
          <span
            role="img"
            aria-label="Instagram — الرابط غير مضاف"
            title="Instagram — بانتظار إضافة الرابط"
          >
            <Instagram size={20} aria-hidden />
          </span>
        </li>
        <li>
          <span
            role="img"
            aria-label="X — الرابط غير مضاف"
            title="X — بانتظار إضافة الرابط"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L2.8 2h6.5l4.4 6.7L18.9 2Zm-1.1 18h1.7L8.4 3.9H6.6L17.8 20Z" />
            </svg>
          </span>
        </li>
        <li>
          <a
            href="https://www.tiktok.com/@manastrafeaf"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="حساب رفرف الرسمي على تيك توك (يفتح في نافذة جديدة)"
            title="حساب رفرف الرسمي على تيك توك"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12.5 0h3.9c.1 1.5.6 3.1 1.8 4.2 1.1 1.1 2.7 1.6 4.2 1.8v4c-1.4 0-2.9-.3-4.2-.9-.6-.3-1.1-.6-1.6-1v8.8c-.1 1.4-.6 2.8-1.4 3.9-1.3 1.9-3.6 3.2-6 3.2-1.4.1-2.9-.3-4.1-1-2.1-1.2-3.5-3.5-3.7-5.9v-1.5c.2-1.9 1.1-3.8 2.6-5 1.7-1.5 4-2.2 6.3-1.8v4.4c-1-.3-2.2-.2-3.1.4-.6.4-1.1 1.1-1.4 1.8-.2.5-.1 1.1-.1 1.6.2 1.7 1.8 3.1 3.5 2.9 1.2 0 2.3-.6 2.8-1.6.2-.4.4-.7.4-1.1.1-1.8.1-3.6.1-5.4V0Z" />
            </svg>
          </a>
        </li>
        <li>
          <span
            role="img"
            aria-label="Snapchat — الرابط غير مضاف"
            title="Snapchat — بانتظار إضافة الرابط"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2.5c-3.2 0-4.8 2.2-4.8 5.1v2.2c-.8.5-1.4-.5-2.1-.2-.8.3-.5 1.1.3 1.5l1.4.5c-.4 2.3-1.6 3.8-3.8 4.5-.8.3-.8 1 .3 1.4l1.8.4.5 1.5c1.3-.3 2.1-.3 3.3.3 1 .6 1.9 1.8 3.1 1.8s2.1-1.2 3.1-1.8c1.2-.6 2-.6 3.3-.3l.5-1.5 1.8-.4c1.1-.4 1.1-1.1.3-1.4-2.2-.7-3.4-2.2-3.8-4.5l1.4-.5c.8-.4 1.1-1.2.3-1.5-.7-.3-1.3.7-2.1.2V7.6c0-2.9-1.6-5.1-4.8-5.1Z" />
            </svg>
          </span>
        </li>
      </ul>
      <p className={styles.pendingNote}>بعض روابط الحسابات بانتظار الإضافة</p>
    </div>
  );
}

/** Add explicitly to public pages; never inject into conversation or account layouts. */
export function SiteFooter() {
  return (
    <footer
      className={styles.footer}
      dir="rtl"
      aria-label="تواصل مع رفرف وروابط الموقع"
    >
      <div className={styles.container}>
        <div className={styles.contactBanner}>
          <div>
            <p className={styles.eyebrow}>تواصل مباشر مع رفرف</p>
            <h2>تحتاج مساعدة في طلبك؟</h2>
          </div>
          <a
            className={styles.whatsappButton}
            href={PUBLIC_CONTACT.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={21} aria-hidden />
            تواصل عبر واتساب
            <ArrowUpLeft size={18} aria-hidden />
          </a>
        </div>

        <div className={styles.grid}>
          <div className={styles.brandColumn}>
            <Link
              href="/"
              className={styles.brand}
              aria-label="رفرف — الصفحة الرئيسية"
            >
              <BrandLogo />
            </Link>
            <p className={styles.description}>
              من تحديد القطعة إلى متابعة طلبك، رحلة واضحة تساعدك على اختيار
              العرض المناسب لمركبتك.
            </p>
            <PendingSocialProfiles />
          </div>

          <nav className={styles.navigation} aria-label="روابط رفرف">
            <h3>روابط تهمك</h3>
            <ul>
              {NAVIGATION.map(({ href, label }) => (
                <li key={href}>
                  <Link href={href}>{label}</Link>
                </li>
              ))}
              <li>
                <a href={SUPPLIER_REGISTRATION_URL}>انضم كمورد</a>
              </li>
            </ul>
          </nav>

          <div className={styles.contactColumn}>
            <h3>الهاتف والواتساب</h3>
            <a
              className={styles.phoneLink}
              href={PUBLIC_CONTACT.phoneHref}
              aria-label={`اتصل برفرف على ${PUBLIC_CONTACT.phoneDisplay}`}
            >
              <span className={styles.phoneIcon}>
                <Phone size={21} aria-hidden />
              </span>
              <span>
                <span className={styles.phoneLabel}>رقم التواصل</span>
                <bdi dir="ltr">{PUBLIC_CONTACT.phoneDisplay}</bdi>
              </span>
            </a>
            <p className={styles.contactNote}>
              يمكنك الاتصال بنا أو مراسلتنا عبر واتساب على الرقم نفسه.
            </p>
          </div>
        </div>

        <div className={styles.bottomBar}>
          <p>© {new Date().getFullYear()} رفرف. جميع الحقوق محفوظة.</p>
          <p>قطع غيار بقرار موثّق</p>
        </div>
      </div>
    </footer>
  );
}
