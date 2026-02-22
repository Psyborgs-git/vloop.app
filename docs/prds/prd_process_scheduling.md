# Product Requirements Document (PRD): Process & Scheduling (FS-4)

## 1. Overview
The Process & Scheduling module (FS-4) is responsible for managing raw long-running processes (LRPs) on the host machine and handling scheduled tasks (cron jobs, delayed execution). It is built as a generic task-runner system that gracefully recovers across daemon restarts.

## 2. Goals & Non-Goals
### Goals
- Spawn and manage child processes with isolated environments and specific working directories.
- Gracefully shutdown LRPs with SIGTERM to SIGKILL escalation.
- Implement robust restart policies natively (Always, On-Failure, Never).
- Monitor LRP health via active probes (HTTP GET, TCP connections, or raw process alive checks).
- Provide a persistent Cron scheduler that survives system reboots using SQLite state tracking.

### Non-Goals
- Full virtual machine provisioning.
- Sandboxing at the system call level (seccomp). We rely on simple Unix process environments unless wrapped in containers (which falls to FS-3).

## 3. Key Scenarios & Capabilities

### Long-Running Processes (LRP)
- **Execution Lifecycle**: Fork/exec a command. If the daemon goes down, standard process trees should be managed. When stopping, send `SIGTERM`, wait a configurable timeout, and escalate to `SIGKILL`.
- **Health Checks**: The orchestrator pings a specified HTTP endpoint or TCP port periodically. If the probe fails beyond a threshold, the process is marked unhealthy and potentially restarted according to policy.
- **Log Ring-Buffer**: Captures stdout and stderr streams natively, storing a limited set (e.g., last 1000 lines) in memory per process, and supports streaming this via WebSocket.

### Cron Scheduling & Workloads
- **Persistent Job Store**: Saves job definitions into the SQLite encrypted database. If the daemon crashes and restarts, it recalculates the `nextRun` from the `cron` expression and resumes cleanly.
- **One-Shot Timers**: Support delayed execution (e.g., "run this at 05:00 UTC") without a repeating cron expression.
- **Execution Limits**: Include soft and hard timeout limits for spawned scheduled tasks.

## 4. Technical Specifications
### Package Structure (`@orch/process`)
- **Spawner (`spawner.ts`)**: Uses standard Node `child_process.spawn`. Injects custom ENV vars and controls working directories safely. Uses `tree-kill` for deep termination.
- **Process Manager (`manager.ts`)**: State machine mapping defined processes to active PIDs. Handles the restart backoff loops and polls health checkers.
- **Scheduler (`scheduler.ts`)**: Uses `cron-parser` to calculate explicit next-tick dates securely. Runs a `setTimeout` chain that is meticulously managed, cancelling timers on job updates or deletions.
- **Log Manager (`logs.ts`)**: Attaches readable streams of LRPs, manages ring buffers dynamically, and dispatches pub/sub payloads for live viewers.
- **Handler (`handler.ts`)**: Serves `process.*` and `schedule.*` endpoints.

## 5. Security & Access Control
- Process spawning poses massive system risk. Access to `process.spawn` must be strictly controlled to authorized RBAC groups (primarily `admin`).
- Jobs define commands which can execute arbitrary shell scripts; all executions are deeply linked to the actor's Audit Log footprint.

## 6. Acceptance Criteria
- [x] LRP gracefully stops with `SIGTERM` and correctly escalates to `SIGKILL` on timeout.
- [x] Restart policies effectively loop crashing services within limit constraints without memory leaks.
- [x] Cron jobs calculate the next interval accurately according to UTC scheduling.
- [x] Scheduled jobs resume correctly if the daemon restarts in between an execution window.
