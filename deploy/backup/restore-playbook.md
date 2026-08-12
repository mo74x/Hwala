# Disaster Recovery and Database Restore Playbook

This runbook outlines emergency recovery procedures for restoring PostgreSQL ledger databases and Redis state from automated backups.

---

## PostgreSQL Restore Procedure

### Scenario: Point-in-Time Database Recovery

Follow these steps to restore a `.sql.gz` dump into PostgreSQL:

#### 1. Locate Target Backup File

Identify the latest healthy backup in `/backups/postgres/`:

```bash
kubectl exec -n hwala-production -it deploy/hwala-core-api -- ls -lh /backups/postgres/
```

#### 2. Scale Down App and Worker Pods

Scale down API and Worker deployments to prevent write operations during restore:

```bash
kubectl scale deployment hwala-core-api --replicas=0 -n hwala-production
kubectl scale deployment hwala-core-worker --replicas=0 -n hwala-production
```

#### 3. Execute Database Restore

Drop existing connections, terminate active locks, and restore from compressed backup:

```bash
# Set variables
NAMESPACE="hwala-production"
POD_NAME="hwala-core-postgres-0"
BACKUP_FILE="/backups/postgres/hwala_db_backup_YYYYMMDD_HHMMSS.sql.gz"

# Terminate active PostgreSQL backend connections
kubectl exec -n ${NAMESPACE} -it ${POD_NAME} -- psql -U hawala_user -d hawala_db -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'hawala_db' AND pid <> pg_backend_pid();"

# Restore database schema and data
kubectl exec -n ${NAMESPACE} -it ${POD_NAME} -- /bin/sh -c \
  "gunzip -c ${BACKUP_FILE} | psql -U hawala_user -d hawala_db"
```

#### 4. Scale Application Back Up

```bash
kubectl scale deployment hwala-core-api --replicas=3 -n hwala-production
kubectl scale deployment hwala-core-worker --replicas=2 -n hwala-production

# Verify rollout status
kubectl rollout status deployment/hwala-core-api -n hwala-production
```

---

## Redis Cache and Queue State Restore Procedure

### Scenario: Restoring Redis RDB Snapshot

#### 1. Scale Down API and Worker Containers

```bash
kubectl scale deployment hwala-core-api --replicas=0 -n hwala-production
kubectl scale deployment hwala-core-worker --replicas=0 -n hwala-production
```

#### 2. Replace RDB File and Restart Redis

```bash
NAMESPACE="hwala-production"
REDIS_POD="hwala-core-redis-0"
RDB_BACKUP="/backups/redis/dump_YYYYMMDD_HHMMSS.rdb"

# Copy backup snapshot to Redis data directory
kubectl exec -n ${NAMESPACE} -it ${REDIS_POD} -- cp ${RDB_BACKUP} /data/dump.rdb

# Restart Redis pod to load dump.rdb into memory
kubectl delete pod ${REDIS_POD} -n ${NAMESPACE}
```

#### 3. Verify Redis Health and Restore API

```bash
# Check Redis readiness
kubectl exec -n ${NAMESPACE} -it ${REDIS_POD} -- redis-cli ping

# Scale services back up
kubectl scale deployment hwala-core-api --replicas=3 -n hwala-production
kubectl scale deployment hwala-core-worker --replicas=2 -n hwala-production
```
