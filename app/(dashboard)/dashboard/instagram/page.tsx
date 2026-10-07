"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PostLookupTab } from "./_components/post-lookup-tab";
import { BrowseFeedTab } from "./_components/browse-feed-tab";
import { HashtagFeedTab } from "./_components/hashtag-feed-tab";
import { MyCreatorsTab } from "./_components/my-creators-tab";

export default function InstagramPage() {
  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-medium">Instagram Posts</h1>
        <p className="text-base text-neutral-500 mt-0.5">
          Look up posts, browse feeds, or explore hashtags
        </p>
      </div>

      <Tabs defaultValue="creators">
        <TabsList className="mb-6 border-b border-neutral-700 w-full justify-start">
          <TabsTrigger value="creators" className="text-base font-semibold text-neutral-500 data-[state=active]:text-white data-[state=active]:border-white">My Creators</TabsTrigger>
          <TabsTrigger value="feed" className="text-base font-semibold text-neutral-500 data-[state=active]:text-white data-[state=active]:border-white">Browse Feed</TabsTrigger>
          <TabsTrigger value="lookup" className="text-base font-semibold text-neutral-500 data-[state=active]:text-white data-[state=active]:border-white">Post Lookup</TabsTrigger>
          <TabsTrigger value="hashtag" className="text-base font-semibold text-neutral-500 data-[state=active]:text-white data-[state=active]:border-white">Hashtag Feed</TabsTrigger>
        </TabsList>

        <TabsContent value="creators">
          <MyCreatorsTab />
        </TabsContent>

        <TabsContent value="feed">
          <BrowseFeedTab />
        </TabsContent>

        <TabsContent value="lookup">
          <PostLookupTab />
        </TabsContent>

        <TabsContent value="hashtag">
          <HashtagFeedTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
