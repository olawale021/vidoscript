"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { r2, storagePrefix } from "./r2";

// Step 1 of the Convex-storage → R2 move (see convex/migrations.ts).
// Copies up to 10 files per run and reschedules itself until nothing is left.
// Safe to re-run: rows that already have an R2 key are skipped.
export const copyToR2 = internalAction({
  args: {},
  handler: async (ctx): Promise<{ copied: number; remaining: number; errors: string[] }> => {
    const { total, batch } = await ctx.runQuery(internal.migrations.pending, { limit: 10 });
    const prefix = storagePrefix();
    let copied = 0;
    const errors: string[] = [];

    for (const t of batch) {
      try {
        let key: string | null = null;
        if (t.field === "video") key = await ctx.runQuery(internal.migrations.knownKey, { storageId: t.storageId });
        if (!key) {
          const blob = await ctx.storage.get(t.storageId);
          if (!blob) throw new Error("file missing in Convex storage");
          const ext = t.field === "thumbnail" ? "jpg" : "mp4";
          const folder = t.table === "renders" ? "renders" : t.table === "projects" ? "uploads" : "library";
          key = await r2.store(ctx, new Uint8Array(await blob.arrayBuffer()), {
            key: `${prefix}/${folder}/${t.userId}/migrated-${t.storageId}.${ext}`,
            type: blob.type || (t.field === "thumbnail" ? "image/jpeg" : "video/mp4"),
          });
        }
        await ctx.runMutation(internal.migrations.setKey, { table: t.table, id: t.id, field: t.field, key });
        copied++;
      } catch (e) {
        errors.push(`${t.table}/${t.id}/${t.field}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const remaining = total - copied;
    // Keep going while progress is being made (errors alone would loop forever).
    if (remaining > 0 && copied > 0) {
      await ctx.scheduler.runAfter(0, internal.migrationsNode.copyToR2, {});
    }
    console.log(`[migrate] copied ${copied}, remaining ${remaining}, errors ${errors.length}`);
    return { copied, remaining, errors };
  },
});
