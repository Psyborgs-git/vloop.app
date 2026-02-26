# Process Management

vloop provides a robust subsystem for managing long-running processes (LRPs) and scheduled tasks directly on the host machine. This replaces the need for external tools like `pm2`, `supervisord`, or system cron for your agent workflows.

## Long-Running Processes (LRP)

You can spawn, monitor, and manage background processes. These processes are supervised by the daemon, meaning they can automatically restart on failure.

### Features
*   **Supervision**: Automatic restarts with configurable backoff policies.
*   **Log Streaming**: Real-time access to stdout/stderr.
*   **Resource Isolation**: (Future) CPU and Memory limits via cgroups.
*   **Health Checks**: TCP, HTTP, or script-based health probes.

### CLI Example

**Start a Python server**:
```bash
orch process spawn \
  --id "api-server" \
  --cmd "python3 -m http.server 8080" \
  --cwd "./backend" \
  --restart "always"
```

**Check Status**:
```bash
orch process list
```

**View Logs**:
```bash
orch process logs api-server --tail 50
```

## Cron Scheduling

vloop includes a distributed-capable cron scheduler. This allows you to schedule tasks (like database backups, report generation, or periodic agent runs) using standard cron syntax.

### Creating a Job

Jobs are persisted to the database, so they survive daemon restarts.

```bash
# Run a backup every day at 3 AM
orch schedule create \
  --id "daily-backup" \
  --cron "0 3 * * *" \
  --cmd "./scripts/backup.sh"
```

### One-Off Tasks

You can also schedule tasks to run once at a specific future time:

```bash
orch schedule create \
  --id "email-reminder" \
  --at "2023-12-25T08:00:00Z" \
  --cmd "echo 'Merry Christmas!'"
```
