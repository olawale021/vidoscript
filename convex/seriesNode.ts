"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { copyObject, storagePrefix } from "./r2";
import type { StoryBible } from "../types/story";

// Save a story's cast + style as a series. Reference images are copied into
// the series' own folder so they survive the story being deleted.
export const saveFromStory = action({
  args: { storyId: v.id("stories"), title: v.string() },
  handler: async (ctx, { storyId, title }): Promise<Id<"series">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const story = await ctx.runQuery(internal.series.storyForSeries, { storyId, userId: identity.subject });
    if (!story) throw new Error("Not found");
    const bible = story.bible as StoryBible | undefined;
    if (!bible || bible.characters.length + bible.locations.length === 0) throw new Error("Plan the story first.");
    if ([...bible.characters, ...bible.locations].some((x) => x.refStatus !== "ready" || !x.refKey)) {
      throw new Error("Wait until every reference picture is ready.");
    }
    const folder = `${storagePrefix()}/stories/${identity.subject}/series/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}/refs`;
    const copy = async <T extends { id: string; refKey?: string | null }>(x: T): Promise<T> => {
      if (x.refKey!.includes("/series/")) return x; // already a series file
      const ext = x.refKey!.split(".").pop() ?? "png";
      const to = `${folder}/${x.id}.${ext}`;
      await copyObject(x.refKey!, to);
      return { ...x, refKey: to };
    };
    const saved: StoryBible = {
      characters: await Promise.all(bible.characters.map(copy)),
      locations: await Promise.all(bible.locations.map(copy)),
    };
    return await ctx.runMutation(internal.series.insertSeries, {
      storyId,
      userId: identity.subject,
      title: title.trim().slice(0, 120) || story.title,
      bible: saved,
    });
  },
});
