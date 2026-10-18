export const COMPANY_CATEGORIES = [
  { id: "all", label: "كل الشركات" },
  { id: "cars", label: "سيارات" },
  { id: "trucks", label: "شاحنات" },
  { id: "equipment", label: "معدات" },
] as const;

export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number]["id"];
export type PartsCompany = {
  id: string;
  name: string;
  description: string;
  categories: Exclude<CompanyCategory, "all">[];
  brands: string[];
  href: string;
};

// Public information checked against each company's official website, 2026-10-18.
// These are directory entries, not supplier accounts or inventory records.
export const PARTS_COMPANIES: PartsCompany[] = [
  {
    id: "abdul-latif-jameel",
    name: "عبداللطيف جميل",
    description: "قطع غيار وخدمات ما بعد البيع للسيارات في المملكة.",
    categories: ["cars"],
    brands: ["تويوتا", "Toyota", "لكزس", "Lexus"],
    href: "https://alj.com/ar/transportation/expanded-vehicle-services/",
  },
  {
    id: "aljomaih",
    name: "الجميح للسيارات",
    description:
      "مراكز خدمة وقطع غيار، مع إمكانية الاستفسار عبر الموقع الرسمي.",
    categories: ["cars"],
    brands: ["جي إم سي", "GMC", "شفروليه", "Chevrolet"],
    href: "https://gmc.ar.aljomaihauto.com/shopping-tools/",
  },
  {
    id: "juffali-commercial",
    name: "الجفالي للمركبات التجارية",
    description: "مركبات تجارية وخدمات وقطع غيار للشاحنات.",
    categories: ["trucks"],
    brands: ["مرسيدس بنز", "Mercedes-Benz", "فوسو", "FUSO"],
    href: "https://www.jipco.com.sa/our-brands",
  },
  {
    id: "zahid-tractor",
    name: "الزاهد للتراكتورات والمعدات الثقيلة",
    description: "معدات إنشاء ومركبات تجارية، وقطع غيار وخدمات ما بعد البيع.",
    categories: ["trucks", "equipment"],
    brands: [
      "كاتربيلر",
      "CAT",
      "فولفو",
      "Volvo",
      "رينو",
      "Renault",
      "يو دي",
      "UD",
    ],
    href: "https://zahidtractor.com/ar/",
  },
];

export function companyCategory(value: unknown): CompanyCategory {
  return (
    COMPANY_CATEGORIES.find((category) => category.id === value)?.id ?? "all"
  );
}

export function normalizeCompanySearch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .toLocaleLowerCase("ar-SA")
    .trim();
}

export function findPartsCompanies(
  category: CompanyCategory,
  query: string,
): PartsCompany[] {
  const words = normalizeCompanySearch(query).split(/\s+/).filter(Boolean);
  return PARTS_COMPANIES.filter((company) => {
    if (category !== "all" && !company.categories.includes(category))
      return false;
    const text = normalizeCompanySearch(
      [company.name, company.description, ...company.brands].join(" "),
    );
    return words.every((word) => text.includes(word));
  });
}
