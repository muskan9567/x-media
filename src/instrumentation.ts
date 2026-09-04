export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { getArchiveJobs } = await import("./lib/tracker/archive-jobs");
    await getArchiveJobs();
  }
}
