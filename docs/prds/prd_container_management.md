# Product Requirements Document (PRD): Container Management (FS-3)

## 1. Overview
The Container Management feature set (FS-3) provides OCI container lifecycle management to the Orchestrator System. It enables spawning, monitoring, streaming logs, and networking for containerized workloads. By leveraging the Docker Engine API, this module supports cross-platform execution (Linux, macOS Docker Desktop, WSL2).

## 2. Goals & Non-Goals
### Goals
- Manage the full lifecycle of containers (create, start, stop, restart, remove).
- Support image management (pull with progress streaming, list, inspect, remove).
- Monitor container health and detect Out-of-Memory (OOM) kills.
- Support real-time log streaming (stdout/stderr).
- Expose all capabilities securely via the WebSocket topic router (`container.*`).

### Non-Goals
- Full cluster orchestration (e.g., Kubernetes swarm features).
- Managing multi-host container networks.
- Abstracting underlying container runtime differences beyond basic API mappings.

## 3. Key Scenarios & Capabilities

### Container Execution
- **Resource Constraints**: Define CPU shares and Memory limits when creating containers.
- **Port Mapping**: Expose and bind container ports to the host's networking stack securely.
- **Volume Mounts**: Mount directories from the host to the container with optional read-only flags.
- **Restart Policies**: Map to Docker's internal restart policies (`always`, `on-failure`, `unless-stopped`).

### Log Streaming & Monitoring
- **Live Tail**: Subscribe to a WebSocket stream that tails `stdout` and `stderr` from a running container.
- **State Change Events**: The system polls and emits events when a container crashes, stops, or goes OOM, allowing autonomous agents to react.

### Image Management
- Seamlessly pull images before running containers, providing standard image reference parsing.

## 4. Technical Specifications
### Package Structure (`@orch/container`)
- **Docker Client (`docker.ts`)**: Wraps `dockerode`. Connects to `/var/run/docker.sock` (Linux/macOS) or named pipes (Windows). Handles daemon availability checks securely and provides high-quality error degradation when Docker is offline.
- **Managers (`containers.ts`, `images.ts`)**: Map high-level CRUD intents into precise `dockerode` invocations.
- **Monitor (`monitor.ts`)**: Background event loop that tracks container states and detects OOM kills via exit code `137`.
- **Log Streamer (`logs.ts`)**: Decodes Docker's multiplexed stdout/stderr stream header format and converts it to JSON WebSocket messages.
- **Handler (`handler.ts`)**: The input boundary. Decodes action requests (`container.create`, `container.logs`, etc.), validates inputs, invokes managers, and packs the response.

## 5. Security & Access Control
- All `container.*` actions require stringent RBAC permissions (e.g., `admin` or high-level `operator`).
- Executing containers with root privileges on the host must be audited.
- Secrets injection handles sensitive data via environment variables securely.

## 6. Acceptance Criteria
- [x] Docker socket auto-discovery works across OS platforms.
- [x] Container start, stop, restart, and remove act as expected.
- [x] Streamed logs match Docker's native `docker logs -f` output accurately.
- [x] OOM detection correctly flags crashed containers with exit code 137.
