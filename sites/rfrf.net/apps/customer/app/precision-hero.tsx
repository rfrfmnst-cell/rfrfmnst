"use client";

import heroImage from "@rafraf/brand/assets/hero/rafraf-cinematic-dark.webp";
import alternatorImage from "@rafraf/brand/assets/parts/alternator-precision.webp";
import { BrandLogo } from "@rafraf/ui/brand-logo";
import {
  Building2,
  Camera,
  Check,
  ScanLine,
  Send,
  Sparkles,
  Waves,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  CHAT_ENTRY_DRAFT_MAX_LENGTH,
  hasChatEntryDraftContent,
  storeChatEntryDraft,
} from "../lib/chat-entry-draft";
import { SUPPLIER_REGISTRATION_URL } from "../lib/public-app-urls";
import { PartSearchMethods } from './part-search-methods';
import type { PartSearchMethod } from '../lib/part-search-intake';
import motionStyles from "./precision-hero-motion.module.css";
import mobileStyles from "./precision-hero-mobile.module.css";
import styles from "./precision-home.module.css";

/**
 * مركبات شائعة في السوق السعودي تدور في لوحة «تحديد المركبة».
 * أسماء طرازات عامة ومدن فقط؛ لا أرقام هيكل حقيقية ولا بيانات عملاء.
 */
const SAUDI_MARKET_VEHICLES = [
  { name: "تويوتا كامري 2019", city: "الرياض" },
  { name: "تويوتا هايلكس 2021", city: "الدمام" },
  { name: "نيسان باترول 2020", city: "جدة" },
  { name: "هيونداي سوناتا 2022", city: "الخبر" },
  { name: "تويوتا لاندكروزر 2018", city: "مكة المكرمة" },
  { name: "جي إم سي يوكن 2023", city: "المدينة المنورة" },
] as const;

const VEHICLE_BEAT_MS = 2600;
const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

export interface PrecisionHeroProps {
  /**
   * لقطة فيديو اختيارية للسوق السعودي (mp4/webm بلا صوت). تُعرض فوق صورة
   * الهيرو وتبقى الصورة هي الغلاف والبديل عند تقليل الحركة أو غياب الملف.
   */
  videoSrc?: string;
}

export function PrecisionHero({ videoSrc }: PrecisionHeroProps = {}) {
  const [request, setRequest] = useState("");
  const [handoffError, setHandoffError] = useState("");
  const [searchMethod, setSearchMethod] = useState<PartSearchMethod | null>(null);
  const reduceMotion = useReducedMotion();

  function goToChat(input: { text?: string; attachmentRequested?: boolean }) {
    setHandoffError("");
    if (!hasChatEntryDraftContent(input)) {
      window.location.assign("/login");
      return;
    }
    let stored = false;
    try {
      stored = storeChatEntryDraft(window.sessionStorage, input);
    } catch {
      // Accessing sessionStorage itself can throw when browser storage is denied.
    }
    if (!stored) {
      setHandoffError(
        "تعذّر حفظ طلبك مؤقتاً في هذا المتصفح. فعّل تخزين الجلسة ثم حاول مرة أخرى.",
      );
      return;
    }
    window.location.assign("/login");
  }

  function startChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    goToChat({ text: request });
  }

  return (
    <section className={styles.hero} aria-labelledby="rafraf-hero-title">
      <motion.div
        className={motionStyles.heroMedia}
        aria-hidden
        initial={reduceMotion ? false : { scale: 1.08 }}
        animate={{ scale: 1 }}
        transition={
          reduceMotion ? { duration: 0 } : { duration: 9, ease: REVEAL_EASE }
        }
      >
        <Image
          className={styles.heroImage}
          src={heroImage}
          alt="مركبة حديثة على طريق حضري وقت الغروب"
          priority
          sizes="100vw"
          fill
        />
        {videoSrc && !reduceMotion ? (
          <video
            className={motionStyles.heroVideo}
            src={videoSrc}
            poster={heroImage.src}
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
          />
        ) : null}
      </motion.div>
      <div className={styles.heroShade} aria-hidden />

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="رفرف — الرئيسية">
          <BrandLogo />
        </Link>
        <nav className={styles.nav} aria-label="التنقل الرئيسي">
          <Link href="/companies">
            <Building2 size={18} aria-hidden /> علامات المركبات
          </Link>
          <a href="#how">كيف تعمل</a>
          <Link className={styles.tracking} href="/track">
            تتبع طلبك
          </Link>
          <a href={SUPPLIER_REGISTRATION_URL}>للموردين</a>
          <Link className={styles.login} href="/login">
            تسجيل الدخول
          </Link>
        </nav>
      </header>

      <div className={`${styles.heroGrid} ${mobileStyles.heroGrid}`}>
        <div className={styles.copy}>
          <div className={styles.eyebrow}>
            <Sparkles size={17} aria-hidden />
            مساعد قطع ذكي للسوق السعودي
          </div>
          <h1 id="rafraf-hero-title" className={mobileStyles.heroTitle}>
            قطعتك تبدأ بوصفك.
            <br />
            والباقي مع رفرف.
          </h1>
          <p>
            من سيارتك إلى شاحنتك ومعداتك، اجمع تفاصيل القطعة في طلب واضح. ابدأ
            بالمحادثة أو اختر علامة مركبتك وحدد تفاصيلها.
          </p>

          <form className={styles.composer} onSubmit={startChat}>
            <label className="sr-only" htmlFor="rafraf-part-request">
              صف القطعة التي تحتاجها
            </label>
            <input
              id="rafraf-part-request"
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="اسم القطعة، رقمها، أو وصف احتياجك…"
              autoComplete="off"
              maxLength={CHAT_ENTRY_DRAFT_MAX_LENGTH}
              aria-describedby="rafraf-part-request-limit"
            />
            <small
              id="rafraf-part-request-limit"
              className={styles.characterCount}
            >
              <bdi dir="ltr">
                {request.length}/{CHAT_ENTRY_DRAFT_MAX_LENGTH}
              </bdi>{" "}
              حرفاً كحد أقصى
            </small>
            <div
              className={styles.composerTools}
              aria-label="طرق إضافة معلومات القطعة"
            >
              <button
                type="button"
                aria-label="الانتقال لإرفاق صورة في المحادثة"
                onClick={() =>
                  goToChat({ text: request, attachmentRequested: true })
                }
              >
                <Camera size={21} aria-hidden />
              </button>
              <span className={styles.unavailableTool}>
                <button
                  type="button"
                  aria-label="البحث برقم الهيكل VIN"
                  onClick={() => setSearchMethod("vin")}
                >
                  <ScanLine size={21} aria-hidden />
                </button>
                <small aria-hidden="true">VIN</small>
              </span>
              <span className={styles.unavailableTool}>
                <button
                  type="button"
                  aria-label="الإملاء الصوتي — قريباً"
                  disabled
                >
                  <Waves size={21} aria-hidden />
                </button>
                <small aria-hidden="true">قريباً</small>
              </span>
            </div>
            <motion.button
              type="submit"
              className={styles.submit}
              whileHover={reduceMotion ? undefined : { y: -2 }}
              whileTap={reduceMotion ? undefined : { scale: 0.98 }}
            >
              <span>ابدأ مع رفرف</span>
              <Send size={19} aria-hidden />
            </motion.button>
            {handoffError ? (
              <p className={styles.composerError} role="alert">
                {handoffError}
              </p>
            ) : null}
          </form>
          <PartSearchMethods activeMethod={searchMethod} onApply={(input) => {
            const text = [request, input.text].filter(Boolean).join('\n');
            if (text.length > CHAT_ENTRY_DRAFT_MAX_LENGTH) { setHandoffError('اختصر الوصف قليلًا حتى نحتفظ به مع بيانات البحث.'); return; }
            goToChat({text, attachmentRequested:input.attachmentRequested});
          }} />
        </div>

        <motion.div
          className={styles.story}
          initial={reduceMotion ? false : "hidden"}
          animate="visible"
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: reduceMotion ? 0 : 0.1 },
            },
          }}
          aria-label="رحلة مطابقة القطعة"
        >
          <StoryPanel className={styles.vehiclePanel} title="تحديد المركبة">
            <Image
              src={heroImage}
              alt="مركبة حديثة جاهزة للتحقق من رقم الهيكل"
              fill
              sizes="180px"
            />
            <VehicleTicker reduceMotion={Boolean(reduceMotion)} />
          </StoryPanel>

          <StoryPanel className={styles.partPanel} title="القطعة المطابقة">
            <Image
              src={alternatorImage}
              alt="دينمو سيارة مصوّر بتفاصيل معدنية دقيقة"
              fill
              priority
              sizes="220px"
            />
            <span
              className={[
                styles.partLine,
                reduceMotion ? "" : motionStyles.partScan,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-hidden
            />
          </StoryPanel>

          <StoryPanel className={styles.offerPanel} title="عرض موثّق">
            <motion.div
              className={styles.verifiedMark}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { delay: 0.55, duration: 0.42, ease: REVEAL_EASE }
              }
            >
              <span className={styles.miniBrand} aria-hidden>
                <BrandLogo compact />
              </span>
              <span>
                رحلة الطلب
                <strong>
                  <Check size={15} aria-hidden /> القرار لك
                </strong>
              </span>
            </motion.div>
          </StoryPanel>
        </motion.div>
      </div>
    </section>
  );
}

/** شريط يدور على مركبات السوق السعودي؛ يثبت على أول مركبة عند تقليل الحركة. */
function VehicleTicker({ reduceMotion }: { reduceMotion: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % SAUDI_MARKET_VEHICLES.length),
      VEHICLE_BEAT_MS,
    );
    return () => window.clearInterval(timer);
  }, [reduceMotion]);

  const vehicle = SAUDI_MARKET_VEHICLES[reduceMotion ? 0 : index];
  if (!vehicle) return null;

  return (
    <div className={styles.scanCode} aria-live="off">
      <ScanLine size={28} aria-hidden />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={vehicle.name}
          className={motionStyles.ticker}
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.32, ease: REVEAL_EASE }
          }
        >
          <strong>{vehicle.name}</strong>
          <small>مثال توضيحي · {vehicle.city}</small>
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function StoryPanel({
  className,
  title,
  children,
}: {
  className?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <motion.article
      className={[styles.storyPanel, className].filter(Boolean).join(" ")}
      variants={{
        hidden: { opacity: 0, x: -28 },
        visible: { opacity: 1, x: 0 },
      }}
      transition={{ duration: 0.42, ease: REVEAL_EASE }}
    >
      <div className={styles.panelBody}>{children}</div>
      <h2>{title}</h2>
    </motion.article>
  );
}
