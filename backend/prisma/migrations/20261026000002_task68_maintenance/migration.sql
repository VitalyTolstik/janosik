-- TASK-68 maintenance schedule: interval (minutes) for the sweep jobs.
ALTER TABLE "OpsSettings" ADD COLUMN     "maintenanceIntervalMinutes" INTEGER;
