# Container Management

vloop integrates directly with the Docker Engine API to provide comprehensive container orchestration capabilities. This allows AI agents to spin up ephemeral environments, run isolated code, or manage microservices.

## Core Capabilities

*   **Lifecycle Management**: Create, start, stop, kill, and remove containers.
*   **Image Management**: Pull images from public or private registries.
*   **Inspection**: Deep introspection of container state, networking, and mounts.
*   **Log Streaming**: Real-time access to container logs.

## Security Model

Unlike giving an agent raw access to the Docker socket (which is equivalent to root access), vloop acts as a secure proxy.
*   **Policy Enforcement**: Restrict which images can be pulled (e.g., only `alpine` or `python:3.10-slim`).
*   **Resource Limits**: Enforce CPU and memory limits on all spawned containers.
*   **Network Isolation**: (Future) Automatically attach containers to isolated bridge networks.

## Usage

### Managing Containers via CLI

**Pull an image**:
```bash
orch container pull postgres:15-alpine
```

**Start a container**:
```bash
orch container run \
  --name "my-db" \
  --image "postgres:15-alpine" \
  --env "POSTGRES_PASSWORD=secret" \
  --port "5432:5432"
```

**List active containers**:
```bash
orch container ls
```

### Agent Integration

Agents can use the provided tools (`spawn_container`, `inspect_container`) to manage infrastructure autonomously.

*Example Prompt:*
> "Start a Redis container named 'cache' on port 6379."

The agent will:
1.  Check if the `redis` image is available (pulling if necessary).
2.  Call `spawn_container` with the correct arguments.
3.  Verify the container is running and healthy.
