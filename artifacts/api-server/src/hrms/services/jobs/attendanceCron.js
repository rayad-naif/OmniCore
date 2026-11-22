const cron = require('node-cron');
const logger = require('../../utils/logger');
const { runAttendanceSweep } = require('../attendanceAutomation.service');
const tenants = require('../../core/tenants');
const { runAsTenant } = require('../../core/context');
const { scopedIo } = require('../../core/io');

/** Runs the attendance sweep once for every workspace with the HR module on. */
async function sweepAllWorkspaces() {
  const ids = await tenants.enabledWorkspaceIds();
  const summary = {
    workspaces: ids.length,
    absentMarked: 0,
    onLeaveMarked: 0,
    errors: 0,
  };
  for (const id of ids) {
    try {
      const ws = await tenants.workspaceInfo(id);
      const results = await runAsTenant(
        id,
        () => runAttendanceSweep(scopedIo(id)),
        {
          timezone: ws?.timezone || 'UTC',
        },
      );
      summary.absentMarked += results.absentMarked || 0;
      summary.onLeaveMarked += results.onLeaveMarked || 0;
      summary.errors += results.errors?.length || 0;
    } catch (err) {
      summary.errors += 1;
      logger.error(`[AttendanceSweep] workspace ${id} failed: ${err.message}`);
    }
  }
  return summary;
}

// Hourly, on one API instance at a time (database lease). Each workspace is
// swept in its own time zone.
function initAttendanceCron() {
  return cron.schedule('17 * * * *', async () => {
    try {
      if (!(await tenants.claimLease('hrms:attendance-sweep', 50 * 60 * 1000)))
        return;
      const summary = await sweepAllWorkspaces();
      await tenants.purgeExpired().catch(() => {});
      logger.info('[AttendanceSweep] done', summary);
    } catch (err) {
      logger.error(`[AttendanceSweep] fatal error: ${err.message}`);
    }
  });
}

module.exports = { initAttendanceCron, sweepAllWorkspaces };
