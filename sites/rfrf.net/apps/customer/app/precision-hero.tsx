"use client";

import heroImage from "@rafraf/brand/assets/hero/rafraf-cinematic-dark.webp";
import alternatorImage from "@rafraf/brand/assets/parts/alternator-precision.webp";
import { BrandLogo } from "@rafraf/ui/brand-logo";
import {
  ArrowLeft,
  Camera,
  SearchCheck,
  ShieldCheck,
  Truck,
  Sparkles,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import {
  CHAT_ENTRY_DRAFT_MAX_LENGTH,
  hasChatEntryDraftContent,
  storeChatEntryDraft,
} from "../lib/chat-entry-draft";
import { manufacturerRequestContext } from "../lib/manufacturers";
import { SUPPLIER_REGISTRATION_URL } from "../lib/public-app-urls";
import {
  ManufacturerPicker,
  EMPTY_VEHICLE_SELECTION,
  type VehicleSelection,
} from "./manufacturer-picker";
import styles from "./precision-home.module.css";

export interface PrecisionHeroProps {
  videoSrc?: string;
}

export function PrecisionHero({ videoSrc }: PrecisionHeroProps = {}) {
  const [request, setRequest] = useState("");
  const [vehicle, setVehicle] = useState<VehicleSelection>(
    EMPTY_VEHICLE_SELECTION,
  );
  const [handoffError, setHandoffError] = useState("");
  const reduceMotion = useReducedMotion();
  const context = manufacturerRequestContext({
    ...vehicle,
    customName: vehicle.custom ? vehicle.customName : "",
  });
  const maxRequestLength = Math.max(
    0,
    CHAT_ENTRY_DRAFT_MAX_LENGTH - context.length,
  );

  function startChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHandoffError("");
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const attachmentRequested =
      submitter instanceof HTMLButtonElement && submitter.name === "attachment";
    const text = context + request.trim();
    if (text.length > CHAT_ENTRY_DRAFT_MAX_LENGTH) {
      setHandoffError(
        `اختصر وصف القطعة إلى ${maxRequestLength} حرفاً لحفظ بيانات المركبة مع طلبك.`,
      );
      return;
    }
    const draft = { text, attachmentRequested };
    let stored = false;
    try {
      stored =
        !hasChatEntryDraftContent(draft) ||
        storeChatEntryDraft(window.sessionStorage, draft);
    } catch {
      /* Storage may be unavailable. */
    }
    if (!stored) {
      setHandoffError(
        "تعذّر حفظ طلبك مؤقتاً في هذا المتصفح. فعّل تخزين الجلسة ثم حاول مرة أخرى.",
      );
      return;
    }
    window.location.assign("/login?next=%2Fchat");
  }

  return (
    <section className={styles.hero} aria-labelledby="rafraf-hero-title">
      <div className={styles.heroMedia} aria-hidden>
        <Image
          className={styles.heroImage}
          src={heroImage}
          alt=""
          priority
          sizes="100vw"
          fill
        />
        {videoSrc && !reduceMotion ? (
          <video
            className={styles.heroVideo}
            src={videoSrc}
            poster={heroImage.src}
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
          />
        ) : null}
      </div>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="رفرف — الرئيسية">
          <BrandLogo />
        </Link>
        <nav className={styles.nav} aria-label="التنقل الرئيسي">
          <a href="#how">كيف تعمل</a>
          <Link className={styles.tracking} href="/track">
            تتبع طلبك
          </Link>
          <a href={SUPPLIER_REGISTRATION_URL}>للموردين</a>
          <Link className={styles.login} href="/login">
            تسجيل الدخول <ArrowLeft size={15} aria-hidden />
          </Link>
        </nav>
      </header>
      <div className={styles.heroGrid}>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>
            <Sparkles size={16} aria-hidden /> قطع غيار السيارات والشاحنات
            والمعدات
          </span>
          <h1 id="rafraf-hero-title">
            قطعتك تبدأ هنا.
            <br />
            <span>اختر مركبتك، وصف احتياجك.</span>
          </h1>
          <p>
            من الشركة المصنّعة إلى طلب واضح. أضف تفاصيل مركبتك، وتابع مطابقة
            القطعة ومقارنة العروض مع رفرف.
          </p>
          <form className={styles.composer} onSubmit={startChat}>
            <ManufacturerPicker
              value={vehicle}
              onChange={(value) => {
                setVehicle(value);
                setHandoffError("");
              }}
            />
            <div className={styles.requestField}>
              <label htmlFor="rafraf-part-request">
                ما القطعة التي تحتاجها؟
              </label>
              <textarea
                id="rafraf-part-request"
                value={request}
                onChange={(event) => {
                  setRequest(event.target.value);
                  setHandoffError("");
                }}
                placeholder="مثال: أحتاج فحمات أمامية، أو اكتب رقم القطعة إن وجد"
                maxLength={maxRequestLength}
                rows={2}
                aria-describedby="rafraf-part-request-limit"
              />
              <small
                id="rafraf-part-request-limit"
                className={styles.characterCount}
              >
                <bdi dir="ltr">
                  {request.length} / {maxRequestLength}
                </bdi>{" "}
                حرفاً للوصف
              </small>
            </div>
            <div className={styles.formActions}>
              <button
                className={styles.attach}
                type="submit"
                name="attachment"
                value="true"
              >
                <Camera size={18} aria-hidden /> أرفق صورة
              </button>
              <button type="submit" className={styles.submit}>
                تابع طلب القطعة <ArrowLeft size={18} aria-hidden />
              </button>
            </div>
            <p className={styles.handoffHint}>
              <ShieldCheck size={14} aria-hidden /> نحفظ اختياراتك مؤقتاً لتكمل
              طلبك بعد تسجيل الدخول.
            </p>
            {handoffError ? (
              <p className={styles.composerError} role="alert">
                {handoffError}
              </p>
            ) : null}
          </form>
        </div>
        <aside className={styles.story} aria-label="رحلة طلب القطعة">
          <div className={styles.visual}>
            <div className={styles.visualHeader}>
              <span>تفاصيل أدق. اختيار أوضح.</span>
              <span className={styles.visualBadge}>رفرف</span>
            </div>
            <div className={styles.partPhoto}>
              <Image
                src={alternatorImage}
                alt="دينمو سيارة بتفاصيل معدنية دقيقة"
                fill
                sizes="(max-width: 760px) 90vw, 42vw"
                priority
              />
            </div>
            <div className={styles.visualCaption}>
              <span>المعلومة الصحيحة أولاً</span>
              <h2>
                من اسم القطعة
                <br />
                إلى قرار يناسبك.
              </h2>
              <p>
                الصورة توضيحية. تأكيد التوافق يتم بعد مراجعة بيانات مركبتك
                والقطعة المطلوبة.
              </p>
            </div>
          </div>
          <ol className={styles.journey}>
            <li>
              <SearchCheck size={22} aria-hidden />
              <span>
                <strong>حدد احتياجك</strong>
                <small>الشركة، الطراز، ووصف القطعة</small>
              </span>
            </li>
            <li>
              <ShieldCheck size={22} aria-hidden />
              <span>
                <strong>راجع المطابقة</strong>
                <small>رقم الهيكل أو رقم القطعة عند الحاجة</small>
              </span>
            </li>
            <li>
              <Truck size={22} aria-hidden />
              <span>
                <strong>قارن وتابع</strong>
                <small>العروض وحالة الطلب في مكان واحد</small>
              </span>
            </li>
          </ol>
        </aside>
      </div>
    </section>
  );
}
