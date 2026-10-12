'use client';

import { BrandLogo } from '@rafraf/ui/brand-logo';
import {
  CarFront,
  ClipboardList,
  Headphones,
  Home,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Star,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';

export function PreviewChatSidebar({ onReset }: { onReset: () => void }) {
  return (
    <aside className="rf-ai-sidebar" aria-label="تنقل مساعد رفرف">
      <Link href="/" className="rf-ai-brand" aria-label="رفرف - الرئيسية">
        <BrandLogo />
      </Link>
      <button type="button" className="rf-ai-new" onClick={onReset}>
        <Plus size={19} aria-hidden /> طلب جديد
      </button>

      <nav className="rf-ai-nav" aria-label="القائمة الرئيسية">
        <Link href="/">
          <Home size={19} aria-hidden /> الرئيسية
        </Link>
        <a className="is-active" href="/chat">
          <MessageCircle size={19} aria-hidden /> المحادثات
        </a>
        <a href="/chat?attach=1">
          <Search size={19} aria-hidden /> طلب قطعة
        </a>
        <a href="/track">
          <ClipboardList size={19} aria-hidden /> طلباتي
        </a>
        <a href="/track">
          <CarFront size={19} aria-hidden /> المركبات
        </a>
        <a href="/track">
          <Star size={19} aria-hidden /> العروض المحفوظة
        </a>
        <a href="/account">
          <MapPin size={19} aria-hidden /> العناوين
        </a>
      </nav>

      <nav className="rf-ai-nav rf-ai-nav-secondary" aria-label="الثقة والدعم">
        <a href="/account">
          <WalletCards size={19} aria-hidden /> محفظتي
        </a>
        <a href="/privacy">
          <Headphones size={19} aria-hidden /> المساعدة والدعم
        </a>
        <a href="/privacy">
          <Settings size={19} aria-hidden /> الإعدادات
        </a>
      </nav>

      <div className="rf-ai-plus-card">
        <strong>رفرف بلس</strong>
        <span>شحن مجاني وعروض حصرية</span>
        <a href="/account">اكتشف المزيد</a>
      </div>
    </aside>
  );
}
