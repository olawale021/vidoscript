import type { Metadata } from "next";
import { CONTACT_EMAIL, UPDATED } from "../legal";

export const metadata: Metadata = { title: "Terms of Service · VidoScript" };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Last updated: {UPDATED}</p>
      <p>By using VidoScript (vidoscript.app) you agree to these terms.</p>

      <h2>Your account</h2>
      <p>You&apos;re responsible for your account and for everything done with it. Keep your sign-in details safe.</p>

      <h2>Your content</h2>
      <ul>
        <li>You keep ownership of what you create and upload.</li>
        <li>
          You must own, or have permission to use, everything you upload or clip, including videos, photos, music and the likeness of
          people in them.
        </li>
        <li>You give us permission to store and process your content only to provide the service to you.</li>
      </ul>

      <h2>Posting to social platforms</h2>
      <ul>
        <li>When you connect an account, VidoScript posts only what you choose, when you choose.</li>
        <li>
          You&apos;re responsible for what you publish and must follow each platform&apos;s rules, including the YouTube Terms of Service,
          TikTok&apos;s Terms of Service and Community Guidelines, and Instagram&apos;s Terms of Use and Community Guidelines.
        </li>
        <li>Label AI-generated or altered content where a platform requires it. VidoScript offers this option when you post.</li>
      </ul>

      <h2>AI features</h2>
      <p>
        AI output can be wrong or unexpected. Check scripts, facts and pictures before you publish. Don&apos;t use VidoScript to make
        content that is illegal, deceptive, harassing, sexual involving minors, or that impersonates real people.
      </p>

      <h2>Service</h2>
      <p>
        We work to keep VidoScript running but can&apos;t promise it will always be available or error-free. We may change or stop features.
        We may suspend accounts that break these terms. To the extent the law allows, VidoScript is provided &quot;as is&quot; and our
        liability is limited to the amount you paid us in the last 12 months.
      </p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </>
  );
}
