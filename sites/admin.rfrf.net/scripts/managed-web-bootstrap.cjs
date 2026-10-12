// Hostinger may require this entry from its loader. Start the original Next app immediately.
require('./apps/admin/server.js');
// Observation and synthetic diagnostics are scheduled after application startup.
require('./managed-storage-scheduler.cjs').scheduleStorageProbe();
