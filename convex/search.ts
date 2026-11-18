import { v } from "convex/values";
import { query } from "./_generated/server";

// ⌘K search over the signed-in user's own work (titles). Per-user lists are
// small, so a scan of the most recent items with a substring match is enough.
export const recent = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;
    const needle = q.trim().toLowerCase();
    const match = (title: string) => !needle || title.toLowerCase().includes(needle);

    const [projects, sources, stories] = await Promise.all([
      ctx.db.query("projects").withIndex("by_user", (x) => x.eq("userId", userId)).order("desc").take(300),
      ctx.db.query("clipSources").withIndex("by_user", (x) => x.eq("userId", userId)).order("desc").take(300),
      ctx.db.query("stories").withIndex("by_user", (x) => x.eq("userId", userId)).order("desc").take(300),
    ]);
    const items = [
      ...projects
        .filter((p) => match(p.title))
        .map((p) => ({ kind: "script" as const, id: p._id as string, title: p.title, href: `/dashboard/project/${p._id}`, at: p.updatedAt })),
      ...sources
        .filter((s) => match(s.title))
        .map((s) => ({ kind: "clips" as const, id: s._id as string, title: s.title, href: `/dashboard/clips/${s._id}`, at: s.updatedAt })),
      ...stories
        .filter((s) => match(s.title) || match(s.idea))
        .map((s) => ({ kind: "story" as const, id: s._id as string, title: s.title, href: `/dashboard/stories/${s._id}`, at: s.updatedAt })),
    ];
    return items.sort((a, b) => b.at - a.at).slice(0, needle ? 20 : 8);
  },
});
