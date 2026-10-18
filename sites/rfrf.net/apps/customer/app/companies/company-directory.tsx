"use client";

import { useState } from "react";
import {
  Building2,
  CarFront,
  ExternalLink,
  Search,
  Tractor,
  Truck,
  X,
} from "lucide-react";
import {
  COMPANY_CATEGORIES,
  findPartsCompanies,
  type CompanyCategory,
} from "../../lib/parts-companies";
import styles from "./companies.module.css";

const ICONS = {
  all: Building2,
  cars: CarFront,
  trucks: Truck,
  equipment: Tractor,
};

export function CompanyDirectory({
  initialCategory,
}: {
  initialCategory: CompanyCategory;
}) {
  const [category, setCategory] = useState(initialCategory);
  const [query, setQuery] = useState("");
  const companies = findPartsCompanies(category, query);
  return (
    <section aria-label="استكشاف شركات قطع الغيار">
      <div className={styles.filters}>
        <div
          className={styles.categories}
          role="group"
          aria-label="نوع المركبة أو المعدات"
        >
          {COMPANY_CATEGORIES.map(({ id, label }) => {
            const Icon = ICONS[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={category === id}
                onClick={() => setCategory(id)}
              >
                <Icon size={20} aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        <label className={styles.search}>
          <Search size={20} aria-hidden />
          <span className="sr-only">ابحث باسم الشركة أو علامة المركبة</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="اسم الشركة أو علامة المركبة"
            maxLength={100}
          />
          {query && (
            <button
              type="button"
              aria-label="مسح البحث"
              onClick={() => setQuery("")}
            >
              <X size={18} aria-hidden />
            </button>
          )}
        </label>
      </div>
      <p className={styles.resultCount} role="status">
        عدد الشركات المعروضة: {companies.length}
      </p>
      {companies.length ? (
        <ul className={styles.grid}>
          {companies.map((company) => (
            <li key={company.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.companyIcon}>
                  <Building2 size={28} aria-hidden />
                </span>
                <span className={styles.location}>
                  المملكة العربية السعودية
                </span>
              </div>
              <h2>{company.name}</h2>
              <p>{company.description}</p>
              <ul className={styles.tags} aria-label="مجالات الشركة">
                {company.categories.map((id) => (
                  <li key={id}>
                    {COMPANY_CATEGORIES.find((item) => item.id === id)?.label}
                  </li>
                ))}
              </ul>
              <a href={company.href} target="_blank" rel="noopener noreferrer">
                الموقع الرسمي <ExternalLink size={17} aria-hidden />
                <span className="sr-only">
                  {" "}
                  لشركة {company.name}، يفتح في نافذة جديدة
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.empty}>
          <Search size={32} aria-hidden />
          <h2>لم نجد شركة بهذا البحث</h2>
          <p>جرّب اسمًا أقصر، أو اختر مجالًا آخر.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCategory("all");
            }}
          >
            عرض كل الشركات
          </button>
        </div>
      )}
    </section>
  );
}
