import { prisma } from '@rafraf/db';
import Link from 'next/link';
import { requireAdminPermission } from '../../lib/require-admin-session';

export const dynamic = 'force-dynamic';

/** شاشة الكتالوج — قطع الإطلاق مجمّعة حسب الفئة، مع شارة «مسودة — يحتاج
 *  تحقق» عندما تكون كل توافقات القطعة تحت عتبة Rule 5 (confidence < 0.85). */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdminPermission('OPERATIONS_READ');
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const parts = await prisma.part.findMany({
    where: query ? { nameAr: { contains: query } } : undefined,
    include: {
      category: true,
      compatibilities: { select: { confidence: true } },
      _count: { select: { compatibilities: true } },
    },
    orderBy: { nameAr: 'asc' },
  });

  const byCategory = new Map<string, typeof parts>();
  for (const p of parts) {
    const key = p.category.nameAr;
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }

  return (
    <main className="ops-main">
      <header className="topbar">
        <div>
          <Link href="/" className="back">
            ← مركز القيادة
          </Link>
          <h1>الكتالوج</h1>
          <p className="sub">
            {parts.length} قطعة
            {query ? ` مطابقة لـ«${query}»` : ' في كتالوج الإطلاق'}
          </p>
        </div>
        <form action="/catalog" method="get" className="status-form qform">
          <input
            name="q"
            defaultValue={query}
            placeholder="ابحث باسم القطعة…"
          />
          <button type="submit">بحث</button>
        </form>
      </header>

      {parts.length === 0 ? (
        <section className="card-block">
          <p className="empty">
            لا قطع مطابقة{query ? ` لـ«${query}»` : ''} — جرّب كلمة أخرى.
          </p>
        </section>
      ) : (
        [...byCategory.entries()].map(([cat, list]) => (
          <section key={cat} className="card-block">
            <h2>
              {cat} ({list.length})
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>القطعة</th>
                    <th>الاسم الإنجليزي</th>
                    <th className="center">التوافقات</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const draft = p.compatibilities.every(
                      (c) => c.confidence < 0.85,
                    );
                    return (
                      <tr key={p.id}>
                        <td className="who">{p.nameAr}</td>
                        <td className="mono">{p.nameEn ?? '—'}</td>
                        <td className="center">
                          <span
                            className={`pill ${p._count.compatibilities ? 'ok' : 'zero'}`}
                          >
                            {p._count.compatibilities}
                          </span>
                        </td>
                        <td>
                          {draft ? (
                            <span className="status s-DRAFT">
                              مسودة — يحتاج تحقق
                            </span>
                          ) : (
                            <span className="status s-QUOTES_READY">موثق</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </main>
  );
}
