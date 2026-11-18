import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("prune system stats", { minuteUTC: 7 }, internal.system.prune);
crons.hourly("prune error logs", { minuteUTC: 37 }, internal.errors.prune);
crons.daily("purge expired clip sources", { hourUTC: 4, minuteUTC: 15 }, internal.clips.purgeExpired);
crons.interval("clip scout: scan due targets", { minutes: 30 }, internal.scoutNode.runDue);
crons.interval("social: publish scheduled posts", { minutes: 5 }, internal.socialNode.runScheduled);
crons.hourly("social: collect post stats", { minuteUTC: 23 }, internal.socialNode.collectStats);
crons.daily("social: refresh tokens", { hourUTC: 3, minuteUTC: 50 }, internal.socialNode.refreshTokens);

export default crons;
