# Social posting setup checklist

When a section is done, add its keys to `.env.local` and tell Claude. They get copied to Convex without being printed.

---

## 1. Instagram (Meta): Unified login (new Meta apps)

- [ ] Your Instagram is a **professional** account (Business or Creator)
- [ ] The Meta app belongs to a **business portfolio** (needed for the Unified login tab)
- [ ] App use case: **Manage messaging & content on Instagram** → **API setup with Unified login**
- [ ] **1. Configure your app → Create new configuration**:
  - Login variation: **General**
  - Access token: **System-user access token (SUAT)**, expiration **Never**
  - Assets: **Instagram account** (ad account not needed)
  - Permissions: **instagram_basic**, **instagram_content_publish**, **instagram_manage_insights** (add it: Edit permissions), **business_management**. Messaging, comments and ads permissions aren't needed.
- [ ] **Redirect URL**: register both, then select the one you're testing with:
  - `https://optimistic-bison-873.convex.site/social/callback/instagram` (dev)
  - `https://site.vidoscript.app/social/callback/instagram` (prod)
- [ ] **App roles → Instagram testers** → add your Instagram, then accept in Instagram (Settings → Website permissions → Apps and websites → Tester invites)
- [ ] Copy the **Configuration ID**, plus the **App ID** and **App secret** from **App settings → Basic** (the Meta app's own ID and secret)

```
META_APP_ID=
META_APP_SECRET=
INSTAGRAM_CONFIG_ID=
```

Later, for public launch: App settings → Basic → Privacy policy `https://app.vidoscript.app/privacy`, Terms `https://app.vidoscript.app/terms`, Data deletion `https://app.vidoscript.app/data-deletion`, then App Review (Advanced Access for each permission) and Live mode.

---

## 2. YouTube (Google Cloud, same project as the YouTube API key)

- [ ] **APIs & Services → Library**: YouTube Data API v3 is on, and enable **YouTube Analytics API**
- [ ] **Google Auth Platform → Branding**: app name VidoScript, plus your support email
- [ ] **Audience**: External, keep it in **Testing**, add **your Google account** as a test user
- [ ] **Data access → Add scopes**: `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`
- [ ] **Clients → Create client → Web application** → Authorized redirect URIs:
  - `https://optimistic-bison-873.convex.site/social/callback/youtube`
  - `https://site.vidoscript.app/social/callback/youtube`
- [ ] Copy the **Client ID** and **Client secret**

```
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
```

While in Testing, you'll need to reconnect about once a week, and uploads may come out private until Google verification and YouTube's API audit are done.

---

## 3. TikTok (being built next; set up whenever you're ready)

- [ ] developers.tiktok.com → sign up → **Manage apps → Create app**
- [ ] Add products **Login Kit** and **Content Posting API** (turn on **Direct Post**)
- [ ] Scopes: `user.info.basic`, `video.publish`, `video.list`
- [ ] **Login Kit → Redirect URI**, add both:
  - `https://optimistic-bison-873.convex.site/social/callback/tiktok`
  - `https://site.vidoscript.app/social/callback/tiktok`
- [ ] App details: website `https://app.vidoscript.app`, privacy and terms URLs (as above; need deploy)
- [ ] **Sandbox**: add your TikTok account as a target user for testing
- [ ] Copy the **Client key** and **Client secret**

```
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

Until TikTok's audit passes, posts are **private only** (you can make them public in the TikTok app). Apply for the audit after testing; it reportedly takes 2–6 weeks.

---

## 4. Check

- [ ] Does **support@vidoscript.app** exist? The privacy, terms and data-deletion pages use it as the contact. If not, tell Claude which email to use.
