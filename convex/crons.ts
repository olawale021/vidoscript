import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly("prune system stats", { minuteUTC: 7 }, internal.system.prune);

export default crons;
