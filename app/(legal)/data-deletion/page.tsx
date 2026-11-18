import type { Metadata } from "next";
import { CONTACT_EMAIL, UPDATED } from "../legal";

export const metadata: Metadata = { title: "Data deletion · VidoScript" };

export default function DataDeletionPage() {
  return (
    <>
      <h1>Delete your data</h1>
      <p>Last updated: {UPDATED}</p>

      <h2>Disconnect a social account</h2>
      <p>
        In VidoScript, open <b>Settings → Connected accounts</b> and press <b>Disconnect</b> next to the account. We delete its access tokens
        right away and can no longer post to it or read its stats. Posts you already published stay on the platform; delete those on the
        platform itself.
      </p>
      <p>
        You can also remove VidoScript&apos;s access from the platform: Instagram (Settings → Apps and websites), Google
        (myaccount.google.com → Security → Third-party connections) or TikTok (Settings → Security → Manage app permissions).
      </p>

      <h2>Delete everything</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address you sign in with, with the subject &quot;Delete my
        data&quot;. We delete your account, content, connected accounts and post records within 30 days and confirm by email.
      </p>
    </>
  );
}
