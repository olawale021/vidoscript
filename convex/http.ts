import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// OAuth return for social accounts: <CONVEX_SITE_URL>/social/callback/<platform>.
// Finishes the connect on the server, then sends the browser back to Settings.
for (const platform of ["instagram", "youtube", "tiktok"]) {
  http.route({
    path: `/social/callback/${platform}`,
    method: "GET",
    handler: httpAction(async (ctx, req) => {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      let returnTo = "https://app.vidoscript.app";
      let result = "error";
      let message = url.searchParams.get("error_description") ?? url.searchParams.get("error_message") ?? "";
      if (code && state) {
        const r = await ctx.runAction(internal.socialNode.finishConnect, { platform, code: code.replace(/#_$/, ""), state });
        returnTo = r.returnTo;
        result = r.ok ? "connected" : "error";
        message = r.message ?? "";
      } else if (!message) {
        message = "Connecting was cancelled.";
      }
      const back = new URL("/dashboard/settings", returnTo);
      back.searchParams.set("social", result);
      back.searchParams.set("platform", platform);
      if (message) back.searchParams.set("message", message.slice(0, 200));
      back.hash = "connected-accounts";
      return Response.redirect(back.toString(), 302);
    }),
  });
}

export default http;
