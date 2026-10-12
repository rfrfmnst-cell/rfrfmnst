/**
 * Static half of the required RBAC test.
 *
 * Today the customer- and supplier-facing surface is Next.js Server Actions and
 * server components that query Prisma directly (see PROGRESS.md), so there is no
 * Nest guard or DTO layer to enforce Rule 2. This test enforces it at the source
 * level instead: it fails the build if a non-admin app so much as names an
 * internal cost field, which is exactly how the two historical leaks
 * ("close supplier-name leak", "close raw-supplier-price leak") got in.
 *
 * A deliberate exception can be marked with `rule2-allow: <reason>` on the same
 * or the preceding line, so an opt-out is visible in review rather than silent.
 */
import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  COST_INTERNAL_FIELDS,
  MARGIN_FIELDS,
  SUPPLIER_IDENTITY_FIELDS,
} from './rule2';

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    try {
      statSync(join(dir, 'pnpm-workspace.yaml'));
      return dir;
    } catch {
      dir = resolve(dir, '..');
    }
  }
  throw new Error('repo root (pnpm-workspace.yaml) not found');
}

const ROOT = repoRoot();
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

function sourceFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Blanks out comments and string literals so prose never trips the scan. */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => m.replace(/[^\n]/g, ' '));
}

interface Violation {
  file: string;
  line: number;
  field: string;
  text: string;
}

function scan(appDir: string, forbidden: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  const root = join(ROOT, appDir);

  for (const file of sourceFiles(root)) {
    const raw = readFileSync(file, 'utf8');
    const rawLines = raw.split('\n');
    const codeLines = stripNonCode(raw).split('\n');

    codeLines.forEach((code, i) => {
      const allowHere = /rule2-allow/.test(rawLines[i] ?? '');
      const allowAbove = /rule2-allow/.test(rawLines[i - 1] ?? '');
      if (allowHere || allowAbove) return;

      for (const field of forbidden) {
        if (new RegExp(`\\b${field}\\b`).test(code)) {
          violations.push({
            file: relative(ROOT, file),
            line: i + 1,
            field,
            text: (rawLines[i] ?? '').trim(),
          });
        }
      }
    });
  }
  return violations;
}

const format = (v: Violation[]): string =>
  v.map((x) => `${x.file}:${x.line} → ${x.field}  |  ${x.text}`).join('\n');

function trustedSupplierQuoteHelpers(code: string): string[] {
  const helpers: string[] = [];
  const declaration =
    /const\s+([A-Za-z_$][\w$]*)(?:\s*:\s*Prisma\.QuoteWhereInput)?\s*=\s*scope\s*\?\s*\{(?=[^}]*\bsupplierId\b)(?=[^}]*\bsourceType\s*:\s*scope\.quoteSourceType)[^}]*\}\s*:\s*\{\s*id\s*:\s*\{\s*in\s*:\s*\[\]\s*\}\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(code)) !== null) {
    helpers.push(match[1]);
  }
  return helpers;
}

function queryCall(code: string, start: number): string {
  const open = code.indexOf('(', start);
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '(') depth += 1;
    if (code[index] === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(start, index + 1);
    }
  }
  return code.slice(start);
}

function whereClause(call: string): string | null {
  const whereIndex = call.search(/\bwhere\s*:/);
  if (whereIndex < 0) return null;
  const nextClause = call
    .slice(whereIndex)
    .search(/\b(?:include|orderBy|select)\s*:/);
  return nextClause < 0
    ? call.slice(whereIndex)
    : call.slice(whereIndex, whereIndex + nextClause);
}

function hasDirectSupplierScope(call: string): boolean {
  const where = whereClause(call);
  return where !== null && /\bsupplierId\b/.test(where);
}

function hasTrustedSupplierQuoteScope(
  call: string,
  helpers: readonly string[],
): boolean {
  const where = whereClause(call);
  return (
    where !== null &&
    helpers.some((helper) => new RegExp(`\\b${helper}\\b`).test(where))
  );
}

function hasMarketRfqScope(call: string): boolean {
  const where = whereClause(call);
  return where !== null && /\bstatus\s*:\s*scope\.rfqStatus\b/.test(where);
}

function findSupplierQueryScopeViolations(
  source: string,
  file: string,
): string[] {
  const code = stripNonCode(source);
  const helpers = trustedSupplierQuoteHelpers(code);
  const offenders: string[] = [];
  const reads =
    /prisma\.(quote|order|rFQ)\.(findMany|findFirst|findUnique)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = reads.exec(code)) !== null) {
    const call = queryCall(code, match.index);
    const model = match[1].toLowerCase();
    const scoped =
      model === 'rfq'
        ? hasMarketRfqScope(call)
        : hasDirectSupplierScope(call) ||
          hasTrustedSupplierQuoteScope(call, helpers);
    if (!scoped) {
      const line = code.slice(0, match.index).split('\n').length;
      const missingScope =
        model === 'rfq' ? 'supplier market scope' : 'supplierId scope';
      offenders.push(
        `${file}:${line} → prisma.${match[1]}.${match[2]} without ${missingScope}`,
      );
    }
  }
  return offenders;
}

describe('Rule 2 source guard — internal cost fields must not appear in non-admin apps', () => {
  it('finds app source to scan (guard is not silently vacuous)', () => {
    expect(sourceFiles(join(ROOT, 'apps/customer')).length).toBeGreaterThan(0);
    expect(sourceFiles(join(ROOT, 'apps/supplier')).length).toBeGreaterThan(0);
  });

  it('apps/customer names no internal cost or supplier-identity field', () => {
    const violations = scan('apps/customer', [
      ...COST_INTERNAL_FIELDS,
      ...SUPPLIER_IDENTITY_FIELDS,
    ]);
    expect(format(violations)).toBe('');
  });

  it('apps/supplier names no margin field', () => {
    const violations = scan('apps/supplier', MARGIN_FIELDS);
    expect(format(violations)).toBe('');
  });
});

describe('Rule 2 source guard — a supplier query must be scoped to its own rows', () => {
  it('accepts a trusted quote helper only when it carries supplierId and sourceType', () => {
    const scopedHelper = `
      const supplierQuoteWhere: Prisma.QuoteWhereInput = scope
        ? { supplierId, sourceType: scope.quoteSourceType }
        : { id: { in: [] } };
      await prisma.quote.findMany({
        where: { ...supplierQuoteWhere, rfqItemId: { in: visibleItemIds } },
      });
      await prisma.rFQ.findMany({
        where: { status: scope.rfqStatus },
      });
    `;
    expect(
      findSupplierQueryScopeViolations(scopedHelper, 'fixture.ts'),
    ).toEqual([]);

    const missingSupplierId = scopedHelper.replace(
      'supplierId, sourceType: scope.quoteSourceType',
      'sourceType: scope.quoteSourceType',
    );
    expect(
      findSupplierQueryScopeViolations(missingSupplierId, 'fixture.ts'),
    ).toEqual([
      'fixture.ts:5 → prisma.quote.findMany without supplierId scope',
    ]);
  });

  it('supplier quote and order reads use own-row scope while RFQ reads use market scope', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(join(ROOT, 'apps/supplier'))) {
      offenders.push(
        ...findSupplierQueryScopeViolations(
          readFileSync(file, 'utf8'),
          relative(ROOT, file),
        ),
      );
    }

    expect(offenders.join('\n')).toBe('');
  });
});
