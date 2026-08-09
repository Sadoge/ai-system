import { isNull, or, eq } from 'drizzle-orm';
import { modelCatalog, type Db } from '@ai-system/db';
import { DEFAULT_PRICING, type ModelPricing } from './pricing.js';

/**
 * Pricing as data (docs/07): the catalog table wins over the compiled-in
 * defaults, so a price change or a new model is a row, not a release. Falls
 * back to the built-in table when the catalog has no entry.
 */
export async function loadPricing(
  db: Db,
  organizationId?: string,
): Promise<Record<string, ModelPricing>> {
  const rows = await db
    .select()
    .from(modelCatalog)
    .where(
      organizationId
        ? or(eq(modelCatalog.organizationId, organizationId), isNull(modelCatalog.organizationId))
        : isNull(modelCatalog.organizationId),
    );
  const pricing: Record<string, ModelPricing> = { ...DEFAULT_PRICING };
  for (const row of rows) {
    if (!row.active) continue;
    pricing[row.model] = {
      inputPerMTok: Number(row.inputPerMTokUsd),
      outputPerMTok: Number(row.outputPerMTokUsd),
    };
  }
  return pricing;
}
