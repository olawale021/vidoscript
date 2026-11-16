import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// One-off move of pre-R2 files from Convex storage to R2.
//   1. npx convex run migrationsNode:copyToR2        (copies, sets *Key fields; old files kept)
//   2. check the app still plays everything
//   3. npx convex run migrations:deleteCopiedStorage (deletes the old Convex files)
// Rows always prefer the R2 key once it is set (convex/r2.ts fileUrl).

export type CopyTask = {
  table: "libraryItems" | "projects" | "renders";
  id: string;
  field: "video" | "thumbnail" | "output";
  storageId: Id<"_storage">;
  userId: string;
};

export const pending = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const tasks: CopyTask[] = [];
    // Library first: projects created from a library item share its file and
    // reuse the key (see knownKey).
    for (const item of await ctx.db.query("libraryItems").collect()) {
      if (item.storageId && !item.videoKey)
        tasks.push({ table: "libraryItems", id: item._id, field: "video", storageId: item.storageId, userId: item.userId });
      if (item.thumbnailStorageId && !item.thumbnailKey)
        tasks.push({ table: "libraryItems", id: item._id, field: "thumbnail", storageId: item.thumbnailStorageId, userId: item.userId });
    }
    for (const p of await ctx.db.query("projects").collect()) {
      if (p.videoStorageId && !p.videoKey)
        tasks.push({ table: "projects", id: p._id, field: "video", storageId: p.videoStorageId, userId: p.userId });
    }
    for (const r of await ctx.db.query("renders").collect()) {
      if (r.outputStorageId && !r.outputKey)
        tasks.push({ table: "renders", id: r._id, field: "output", storageId: r.outputStorageId, userId: r.userId });
    }
    return { total: tasks.length, batch: tasks.slice(0, limit) };
  },
});

// R2 key already assigned to this Convex file (shared library/project video).
export const knownKey = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    for (const item of await ctx.db.query("libraryItems").collect()) {
      if (item.storageId === storageId && item.videoKey) return item.videoKey;
    }
    for (const p of await ctx.db.query("projects").collect()) {
      if (p.videoStorageId === storageId && p.videoKey) return p.videoKey;
    }
    return null;
  },
});

export const setKey = internalMutation({
  args: {
    table: v.union(v.literal("libraryItems"), v.literal("projects"), v.literal("renders")),
    id: v.string(),
    field: v.union(v.literal("video"), v.literal("thumbnail"), v.literal("output")),
    key: v.string(),
  },
  handler: async (ctx, { table, id, field, key }) => {
    if (table === "libraryItems") {
      const docId = ctx.db.normalizeId("libraryItems", id);
      if (docId) await ctx.db.patch(docId, field === "thumbnail" ? { thumbnailKey: key } : { videoKey: key });
    } else if (table === "projects") {
      const docId = ctx.db.normalizeId("projects", id);
      if (docId) await ctx.db.patch(docId, { videoKey: key });
    } else {
      const docId = ctx.db.normalizeId("renders", id);
      if (docId) await ctx.db.patch(docId, { outputKey: key });
    }
    return null;
  },
});

// Step 3: remove Convex copies of files that now live in R2. Run only after
// checking the app plays everything from R2.
export const deleteCopiedStorage = internalMutation({
  args: {},
  handler: async (ctx) => {
    const done = new Set<string>();
    let deleted = 0;
    const drop = async (id: Id<"_storage">) => {
      if (done.has(id)) return;
      done.add(id);
      await ctx.storage.delete(id).catch(() => {});
      deleted++;
    };
    for (const item of await ctx.db.query("libraryItems").collect()) {
      const patch: Record<string, undefined> = {};
      if (item.storageId && item.videoKey) {
        await drop(item.storageId);
        patch.storageId = undefined;
      }
      if (item.thumbnailStorageId && item.thumbnailKey) {
        await drop(item.thumbnailStorageId);
        patch.thumbnailStorageId = undefined;
      }
      if (Object.keys(patch).length) await ctx.db.patch(item._id, patch);
    }
    for (const p of await ctx.db.query("projects").collect()) {
      if (p.videoStorageId && p.videoKey) {
        await drop(p.videoStorageId);
        await ctx.db.patch(p._id, { videoStorageId: undefined });
      }
    }
    for (const r of await ctx.db.query("renders").collect()) {
      if (r.outputStorageId && r.outputKey) {
        await drop(r.outputStorageId);
        await ctx.db.patch(r._id, { outputStorageId: undefined });
      }
    }
    return { deleted };
  },
});
