import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("prune system stats", { minuteUTC: 7 }, internal.system.prune);
crons.hourly("prune error logs", { minuteUTC: 37 }, internal.errors.prune);
crons.daily("purge expired clip sources", { hourUTC: 4, minuteUTC: 15 }, internal.clips.purgeExpired);
crons.interval("clip scout: scan due targets", { minutes: 30 }, internal.scoutNode.runDue);

export default crons;
