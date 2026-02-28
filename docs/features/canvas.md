# Canvas Runtime

The Canvas Runtime allows vloop to host dynamic, file-backed UI canvases with realtime backend ↔ frontend state communication.

## What it provides

- **Root landing page** (`/`): animated HTML/CSS/JS page that lists active canvases.
- **Canvas static hosting** (`/:id/*`): serves canvas files from the canvas storage directory.
- **Automatic IPC preload**: every served canvas HTML file gets a default script injected (`window.CanvasState`) so canvases can subscribe, send events, and sync state in realtime.
- **Realtime state manager**: websocket-based service for canvas rooms keyed by `canvasId`.

## HTTP Endpoints

### `GET /canvases`
Returns all canvases from the AI config store.

### `GET /:id/data`
Returns persisted canvas `content` JSON/text.

### `GET /:id/state`
Returns the current in-memory state map for the canvas.

### `POST /:id/state`
Merges partial state into the canvas state and broadcasts `STATE_UPDATED` to connected clients.

### `POST /:id/event`
Broadcasts a custom event payload to connected clients for the canvas.

## Realtime transport

The server exposes a websocket endpoint at:

- `/_canvas-ipc?canvasId=<id>`

Each `canvasId` behaves like a room:

- state updates are stored in memory per canvas
- connected clients receive `INIT_STATE` and `STATE_UPDATED`
- arbitrary custom messages can be broadcast for UI events

## Frontend API injected into canvas HTML

The injected script creates `window.CanvasState` with:

- `onState(callback)` — subscribe to state updates
- `onEvent(callback)` — subscribe to non-state events
- `update(partialState)` — merge + broadcast state update
- `send(type, payload)` — send custom event message
- `getState()` — read local current state snapshot

## Example

```html
<script>
  window.CanvasState.onState((state) => {
    document.getElementById('status').textContent = JSON.stringify(state);
  });

  function increment() {
    const current = window.CanvasState.getState();
    window.CanvasState.update({ count: (current.count || 0) + 1 });
  }
</script>
```

## Notes

- State persistence is currently in-memory for live sessions.
- Canvas files are persisted on disk in the configured canvas storage path.
- Commit history and file diffs are persisted by the AI config store (`canvases`, `canvas_commits`).
