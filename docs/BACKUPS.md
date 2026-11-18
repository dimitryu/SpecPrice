# Firestore backups and point-in-time recovery (PITR)

The in-app Recycle Bin covers single deleted items. These two Google Cloud
settings cover the rest: a bad bulk change, a bug, or a compromised account.

Run once, from a machine where `gcloud` is signed in as a project Owner:

```bash
gcloud config set project specprice-236a2

# 1. Point-in-time recovery: read/restore the database as it was at any
#    minute in the last 7 days.
gcloud firestore databases update --database='(default)' --enable-pitr

# 2. Daily backup kept for 14 days.
gcloud firestore backups schedules create --database='(default)' \
    --recurrence=daily --retention=14d

# Check both:
gcloud firestore databases describe --database='(default)' \
    --format='value(pointInTimeRecoveryEnablement,earliestVersionTime)'
gcloud firestore backups schedules list --database='(default)'
```

## Restoring

A restore always goes into a **new** database — it never overwrites the live one.

```bash
# From a daily backup
gcloud firestore backups list --format='table(name,snapshotTime)'
gcloud firestore databases restore --source-backup=<BACKUP_NAME> \
    --destination-database=restore-YYYYMMDD

# From a point in time (PITR) — export that moment, then import what you need
gcloud firestore export gs://<bucket>/pitr-YYYYMMDD \
    --snapshot-time=2026-11-18T09:00:00Z
```

Copy the needed documents back from the restored database (or import the
export), check them, then delete the restore database.

Cost: PITR and backups are billed by stored size; for this app's data volume
it is a few cents to a few dollars a month.
