"use client";

import { Car, Truck, Tractor, Search, Check, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import {
  VEHICLE_CATEGORIES,
  searchManufacturers,
  type Manufacturer,
  type VehicleCategory,
} from "../lib/manufacturers";
import styles from "./manufacturer-picker.module.css";

export interface VehicleSelection {
  category: VehicleCategory;
  manufacturer?: Manufacturer;
  custom: boolean;
  customName: string;
  model: string;
  year: string;
}
export const EMPTY_VEHICLE_SELECTION: VehicleSelection = {
  category: "cars",
  custom: false,
  customName: "",
  model: "",
  year: "",
};
const CATEGORY_ICONS = { cars: Car, trucks: Truck, equipment: Tractor };

export function ManufacturerPicker({
  value,
  onChange,
}: {
  value: VehicleSelection;
  onChange: (selection: VehicleSelection) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const brands = searchManufacturers(value.category, query);
  const visible = expanded || query ? brands : brands.slice(0, 8);
  const CategoryIcon = CATEGORY_ICONS[value.category];
  const selected = value.manufacturer;

  return (
    <fieldset className={styles.picker}>
      <legend>
        اختر الشركة المصنّعة <span>اختياري</span>
      </legend>
      <div className={styles.categories} aria-label="نوع المركبة">
        {VEHICLE_CATEGORIES.map(({ id, label }) => {
          const Icon = CATEGORY_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              aria-pressed={value.category === id}
              onClick={() => {
                onChange({ ...EMPTY_VEHICLE_SELECTION, category: id });
                setQuery("");
                setExpanded(false);
              }}
            >
              <Icon size={18} aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
      <label className={styles.search}>
        <Search size={17} aria-hidden />
        <span className="sr-only">ابحث عن الشركة بالعربية أو الإنجليزية</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث عن الشركة بالعربية أو الإنجليزية"
          maxLength={70}
          autoComplete="off"
        />
      </label>
      <div
        className={`${styles.brands} ${expanded || query ? styles.expanded : ""}`}
        aria-label="الشركات المصنّعة"
      >
        {visible.map((brand) => (
          <button
            key={brand.id}
            type="button"
            className={styles.brand}
            aria-pressed={selected?.id === brand.id}
            onClick={() =>
              onChange({
                ...value,
                manufacturer: brand,
                custom: false,
                customName: "",
                model: selected?.id === brand.id ? value.model : "",
                year: selected?.id === brand.id ? value.year : "",
              })
            }
          >
            <span className={styles.logo}>
              {brand.logo && brand.sprite ? (
                <span
                  aria-hidden
                  style={{
                    display: "block",
                    width: `${brand.sprite.width * Math.min(70 / brand.sprite.width, 34 / brand.sprite.height)}px`,
                    height: `${brand.sprite.height * Math.min(70 / brand.sprite.width, 34 / brand.sprite.height)}px`,
                    backgroundImage: `url(${brand.logo})`,
                    backgroundRepeat: "no-repeat",
                    backgroundSize: `${brand.sprite.sheetWidth * Math.min(70 / brand.sprite.width, 34 / brand.sprite.height)}px ${brand.sprite.sheetHeight * Math.min(70 / brand.sprite.width, 34 / brand.sprite.height)}px`,
                    backgroundPosition: `-${brand.sprite.x * Math.min(70 / brand.sprite.width, 34 / brand.sprite.height)}px -${brand.sprite.y * Math.min(70 / brand.sprite.width, 34 / brand.sprite.height)}px`,
                  }}
                />
              ) : brand.logo ? (
                <Image
                  src={brand.logo}
                  width={72}
                  height={36}
                  alt=""
                  unoptimized
                />
              ) : (
                <CategoryIcon size={29} aria-hidden />
              )}
            </span>
            <span>{brand.ar}</span>
            <bdi dir="ltr">{brand.en}</bdi>
            {selected?.id === brand.id ? (
              <Check size={15} className={styles.check} aria-hidden />
            ) : null}
          </button>
        ))}
      </div>
      {brands.length === 0 ? (
        <p className={styles.empty} role="status">
          لم نجد هذه الشركة. يمكنك إدخال اسمها من خيار «شركة أخرى».
        </p>
      ) : null}
      <div className={styles.actions}>
        {!query ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "عرض المختصر" : `عرض جميع الشركات (${brands.length})`}
          </button>
        ) : (
          <span role="status">{brands.length} نتيجة</span>
        )}
        <button
          type="button"
          aria-pressed={value.custom}
          onClick={() =>
            onChange({
              ...EMPTY_VEHICLE_SELECTION,
              category: value.category,
              custom: true,
            })
          }
        >
          شركة أخرى
        </button>
      </div>
      {selected || value.custom ? (
        <div className={styles.selection}>
          <div className={styles.selected} aria-live="polite">
            <span>
              <Check size={16} aria-hidden />
              {selected ? `${selected.ar} · ${selected.en}` : "شركة أخرى"}
            </span>
            <button
              type="button"
              aria-label="إلغاء اختيار الشركة"
              onClick={() =>
                onChange({
                  ...EMPTY_VEHICLE_SELECTION,
                  category: value.category,
                })
              }
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          {value.custom ? (
            <label className={styles.field}>
              اسم الشركة
              <input
                required
                value={value.customName}
                maxLength={50}
                onChange={(event) =>
                  onChange({ ...value, customName: event.target.value })
                }
                placeholder="اكتب اسم الشركة المصنّعة"
              />
            </label>
          ) : null}
          <div className={styles.vehicleFields}>
            <label className={styles.field}>
              الطراز <span>اختياري</span>
              <input
                value={value.model}
                maxLength={50}
                onChange={(event) =>
                  onChange({ ...value, model: event.target.value })
                }
                placeholder="مثال: كامري، أكتروس، PC200"
              />
            </label>
            <label className={styles.field}>
              سنة الصنع <span>اختياري</span>
              <input
                type="number"
                inputMode="numeric"
                min="1900"
                max={new Date().getFullYear() + 1}
                step="1"
                value={value.year}
                onChange={(event) =>
                  onChange({ ...value, year: event.target.value.slice(0, 4) })
                }
                placeholder="2020"
              />
            </label>
          </div>
        </div>
      ) : null}
      <p className={styles.note}>
        اختيار الشركة يساعد في وصف طلبك؛ مطابقة القطعة تُراجع برقم الهيكل أو رقم
        القطعة.
      </p>
    </fieldset>
  );
}
