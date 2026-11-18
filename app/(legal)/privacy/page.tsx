import type { Metadata } from "next";
import { CONTACT_EMAIL, UPDATED } from "../legal";

export const metadata: Metadata = { title: "Privacy Policy · VidoScript" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated: {UPDATED}</p>
      <p>
        VidoScript (&quot;we&quot;, &quot;us&quot;) is a video creation tool at vidoscript.app. This policy explains what we collect, why,
        and the choices you have.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Account details from our sign-in provider (Clerk): your name, email address and user id.</li>
        <li>Content you create or upload: videos, scripts, pictures, voice-overs, captions and settings.</li>
        <li>Usage and cost records for AI features, and error logs, so we can run and improve the service.</li>
        <li>
          When you connect a social account (Instagram, YouTube or TikTok): the account id, username, name and profile picture, the access
          tokens the platform gives us, and the posts you publish through VidoScript with their public statistics (views, likes, comments,
          shares, saves, reach and watch time).
        </li>
      </ul>

      <h2>How we use connected social accounts</h2>
      <ul>
        <li>Only to do what you ask: publish the videos you choose, with the caption and settings you choose, at the time you choose.</li>
        <li>To show you how those posts perform, and to improve the suggestions VidoScript makes for you.</li>
        <li>We never post anything you didn&apos;t ask us to post, and we never read your private messages.</li>
        <li>Access tokens are stored encrypted and are used only by our servers. They are deleted when you disconnect the account.</li>
      </ul>
      <p>
        Use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use
        requirements. YouTube features use YouTube API Services; see the YouTube Terms of Service and the Google Privacy Policy
        (policies.google.com/privacy). You can revoke VidoScript&apos;s access at any time from your Google security settings.
      </p>

      <h2>Who we share data with</h2>
      <p>
        We don&apos;t sell your data. We use service providers to run VidoScript: Clerk (sign-in), Cloudflare R2 (file storage), our own
        servers (database and processing), and AI providers (OpenAI, Google Gemini, Groq, fal.ai, Higgsfield) that process the content you
        send to AI features. Videos you choose to publish are sent to the platform you choose (Instagram, YouTube or TikTok).
      </p>

      <h2>How long we keep data</h2>
      <p>
        We keep your content and account data while your account is active. Uploaded source videos for clipping are deleted automatically
        after a period. Stats for published posts are kept so you can see their history. You can delete content at any time in the app, and
        you can ask us to delete everything (see the Data deletion page).
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Disconnect any social account in Settings → Connected accounts.</li>
        <li>Delete stories, clips and other content from the app.</li>
        <li>
          Ask for a copy or deletion of your data by emailing <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}
