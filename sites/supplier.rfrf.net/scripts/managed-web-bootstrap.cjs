require('./managed-action-origin.cjs').installManagedActionOrigin('https://supplier.rfrf.net');
// Hostinger may require this entry from its loader. Start the original app immediately.
require('./apps/supplier/server.js');
// Observation and synthetic diagnostics are scheduled after application startup.
require('./managed-storage-scheduler.cjs').scheduleStorageProbe();
