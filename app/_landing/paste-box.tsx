"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Icon } from "./art";

// Hero link box: signed-in users go straight to the new-project page with the
// link prefilled; everyone else signs up first.
export function PasteBox() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const [url, setUrl] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const link = url.trim();
    if (isSignedIn) {
      router.push(link ? `/dashboard/new?url=${encodeURIComponent(link)}` : "/dashboard/new");
    } else {
      router.push("/sign-up");
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-8 flex max-w-[520px] flex-wrap items-center gap-2 rounded-[14px] border border-line-strong bg-surface py-1.5 pl-3.5 pr-1.5 shadow-[0_0_0_6px_rgba(255,255,255,.02)] focus-within:border-[#55555c] max-sm:p-2"
    >
      <div className="flex min-w-0 flex-1 basis-[220px] items-center gap-2 max-sm:px-1.5 max-sm:py-1">
        <Icon name="link" className="text-faint" />
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube or Instagram link"
          aria-label="Video link"
          className="min-w-0 flex-1 border-0 bg-transparent text-base text-fg outline-none placeholder:text-faint focus-visible:outline-none sm:text-[15px]"
        />
      </div>
      <button
        type="submit"
        className="inline-flex h-[38px] items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-fg px-4 text-sm font-semibold text-bg transition hover:bg-[#dcdcd8] max-sm:w-full"
      >
        Write my script
      </button>
    </form>
  );
}
