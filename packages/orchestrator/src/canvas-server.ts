import express from 'express';
import http from 'http';
import type { Logger } from '@orch/daemon';
import type { AIConfigStore } from '@orch/ai-agent';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasStateManager } from './canvas-state-manager.js';

export interface CanvasServerHandle {
    listen(): Promise<void>;
    close(): Promise<void>;
    stateManager: CanvasStateManager;
}

const DEFAULT_IPC_PATH = '/_canvas-ipc';

function resolveWebIndexPath(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.join(currentDir, 'web', 'index.html');
    const srcPath = path.join(currentDir, '..', 'src', 'web', 'index.html');

    if (fs.existsSync(distPath)) return distPath;
    return srcPath;
}

function createInjectedIpcScript(canvasId: string): string {
    return `
<script id="canvas-ipc-client">
(() => {
  const canvasId = ${JSON.stringify(canvasId)};
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = wsProtocol + '//' + window.location.host + '${DEFAULT_IPC_PATH}?canvasId=' + encodeURIComponent(canvasId);

  /** @type {WebSocket | null} */
  let socket = null;
  let reconnectTimer = null;
  let currentState = {};
  const stateSubscribers = [];
  const eventSubscribers = [];
  const pendingDialogs = new Map();

  function ensureOverlayRoot() {
    let root = document.getElementById('__canvas-overlay-root__');
    if (root) return root;

    root = document.createElement('div');
    root.id = '__canvas-overlay-root__';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '2147483647';
    root.innerHTML = [
      '<div id="__canvas-toast-stack__" style="position:absolute;top:20px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:10px;align-items:center;max-width:min(92vw,640px);"></div>',
      '<div id="__canvas-dialog-backdrop__" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(6,10,20,0.52);backdrop-filter:blur(2px);pointer-events:auto;">',
      '<div id="__canvas-dialog-card__" style="width:min(92vw,520px);border-radius:16px;border:1px solid rgba(255,255,255,0.16);box-shadow:0 28px 80px rgba(0,0,0,0.45);padding:20px;background:linear-gradient(180deg, rgba(25,32,48,0.97), rgba(14,18,29,0.97));color:#f3f6ff;transform:translateY(12px) scale(0.98);opacity:0;transition:all 180ms ease;">',
      '  <div id="__canvas-dialog-title__" style="font-size:16px;font-weight:700;letter-spacing:0.01em;"></div>',
      '  <div id="__canvas-dialog-message__" style="margin-top:8px;font-size:14px;line-height:1.45;opacity:0.88;"></div>',
      '  <input id="__canvas-dialog-input__" style="margin-top:14px;width:100%;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);padding:0 12px;background:rgba(255,255,255,0.08);color:#fff;outline:none;" />',
      '  <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px;">',
      '    <button id="__canvas-dialog-cancel__" style="height:36px;padding:0 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#e2e8ff;cursor:pointer;">Cancel</button>',
      '    <button id="__canvas-dialog-confirm__" style="height:36px;padding:0 14px;border-radius:9px;border:0;background:linear-gradient(120deg,#6b7bff,#8b5cf6);color:#fff;font-weight:600;cursor:pointer;">Confirm</button>',
      '  </div>',
      '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(root);
    return root;
  }

  function toast(payload) {
    const root = ensureOverlayRoot();
    const stack = root.querySelector('#__canvas-toast-stack__');
    if (!stack) return;

    const severity = payload?.severity || 'info';
    const palette = {
      success: 'linear-gradient(120deg,#059669,#10b981)',
      error: 'linear-gradient(120deg,#dc2626,#ef4444)',
      warning: 'linear-gradient(120deg,#d97706,#f59e0b)',
      info: 'linear-gradient(120deg,#2563eb,#3b82f6)'
    };

    const item = document.createElement('div');
    item.style.pointerEvents = 'auto';
    item.style.padding = '10px 14px';
    item.style.borderRadius = '12px';
    item.style.background = palette[severity] || palette.info;
    item.style.color = '#fff';
    item.style.boxShadow = '0 12px 30px rgba(0,0,0,0.28)';
    item.style.fontSize = '13px';
    item.style.fontWeight = '600';
    item.style.maxWidth = '100%';
    item.style.wordBreak = 'break-word';
    item.style.opacity = '0';
    item.style.transform = 'translateY(-8px) scale(0.98)';
    item.style.transition = 'all 200ms ease';
    item.textContent = payload?.message || '';
    stack.appendChild(item);

    requestAnimationFrame(() => {
      item.style.opacity = '1';
      item.style.transform = 'translateY(0) scale(1)';
    });

    const durationMs = typeof payload?.durationMs === 'number' ? payload.durationMs : 3600;
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(-8px) scale(0.98)';
      setTimeout(() => item.remove(), 200);
    }, Math.max(1200, durationMs));
  }

  function showDialog(payload) {
    const root = ensureOverlayRoot();
    const backdrop = root.querySelector('#__canvas-dialog-backdrop__');
    const card = root.querySelector('#__canvas-dialog-card__');
    const title = root.querySelector('#__canvas-dialog-title__');
    const message = root.querySelector('#__canvas-dialog-message__');
    const input = root.querySelector('#__canvas-dialog-input__');
    const confirmBtn = root.querySelector('#__canvas-dialog-confirm__');
    const cancelBtn = root.querySelector('#__canvas-dialog-cancel__');
    if (!backdrop || !card || !title || !message || !input || !confirmBtn || !cancelBtn) return;

    const requestId = payload?.requestId;
    if (!requestId) return;

    title.textContent = payload?.title || 'Input required';
    message.textContent = payload?.message || 'Please provide input.';
    input.placeholder = payload?.placeholder || '';
    input.value = payload?.defaultValue || '';
    input.type = payload?.inputType || 'text';
    confirmBtn.textContent = payload?.confirmLabel || 'Confirm';
    cancelBtn.textContent = payload?.cancelLabel || 'Cancel';

    const cleanup = () => {
      backdrop.style.display = 'none';
      card.style.opacity = '0';
      card.style.transform = 'translateY(12px) scale(0.98)';
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      pendingDialogs.delete(requestId);
    };

    const respond = (confirmed) => {
      send('UI_DIALOG_RESPONSE', {
        requestId,
        confirmed,
        value: confirmed ? String(input.value || '') : undefined,
      });
      cleanup();
    };

    pendingDialogs.set(requestId, { cleanup });
    backdrop.style.display = 'flex';

    requestAnimationFrame(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0) scale(1)';
      input.focus();
      if (input.select) input.select();
    });

    confirmBtn.onclick = () => respond(true);
    cancelBtn.onclick = () => respond(false);
    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        respond(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        respond(false);
      }
    };
  }

  function notifyState(state) {
    currentState = state || {};
    stateSubscribers.forEach((cb) => {
      try { cb(currentState); } catch (err) { console.error('CanvasState subscriber error', err); }
    });
  }

  function notifyEvent(message) {
    eventSubscribers.forEach((cb) => {
      try { cb(message); } catch (err) { console.error('Canvas event subscriber error', err); }
    });
  }

  function send(type, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, payload, canvasId }));
    return true;
  }

  function connect() {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'INIT_STATE' || message.type === 'STATE_UPDATED') {
          notifyState(message.payload || {});
          return;
        }
        if (message.type === 'UI_TOAST') {
          toast(message.payload || {});
          return;
        }
        if (message.type === 'UI_DIALOG_REQUEST') {
          showDialog(message.payload || {});
          return;
        }
        notifyEvent(message);
      } catch (err) {
        console.error('Canvas IPC parse error', err);
      }
    };

    socket.onclose = () => {
      reconnectTimer = setTimeout(connect, 1000);
    };
  }

  connect();

  window.CanvasState = {
    onState(callback) {
      stateSubscribers.push(callback);
      callback(currentState);
    },
    onEvent(callback) {
      eventSubscribers.push(callback);
    },
    update(partialState) {
      return send('UPDATE_STATE', partialState || {});
    },
    send(type, payload) {
      return send(type, payload);
    },
    getState() {
      return currentState;
    }
  };

  window.CanvasUI = {
    toast,
    prompt(payload) {
      showDialog(payload || {});
    }
  };
})();
</script>`;
}

export function createCanvasServer(
    port: number,
    bindAddress: string,
    logger: Logger,
    aiConfigStore: AIConfigStore,
    canvasesPath: string,
): CanvasServerHandle {
    const app = express();
    const server = http.createServer(app);
    const stateManager = new CanvasStateManager(server, logger, { path: DEFAULT_IPC_PATH });

    app.use(express.json());

    app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });

    app.get('/canvases', (_req, res) => {
        try {
            const canvases = aiConfigStore.listCanvases();
            res.json({ canvases });
        } catch (error) {
            logger.error(`Error listing canvases: ${error instanceof Error ? error.message : String(error)}`);
            res.status(500).send('Internal Server Error');
        }
    });

    app.get('/:id/data', (req, res) => {
        try {
            const canvasId = req.params.id as any;
            const canvas = aiConfigStore.getCanvas(canvasId);

            if (!canvas) {
                return res.status(404).send('Canvas not found');
            }

            res.setHeader('Content-Type', 'application/json');
            return res.send(canvas.content || '{}');
        } catch (error) {
            logger.error(`Error retrieving canvas data ${req.params.id}: ${error instanceof Error ? error.message : String(error)}`);
            return res.status(500).send('Internal Server Error');
        }
    });

    app.get('/:id/state', (req, res) => {
        const canvasId = req.params.id;
        return res.json({ canvasId, state: stateManager.getState(canvasId) });
    });

    app.post('/:id/state', (req, res) => {
        const canvasId = req.params.id;
        const payload = (req.body ?? {}) as Record<string, unknown>;
        stateManager.updateState(canvasId, payload);
        return res.json({ canvasId, state: stateManager.getState(canvasId) });
    });

    app.post('/:id/event', (req, res) => {
        const canvasId = req.params.id;
        const { type, payload } = req.body ?? {};
        if (!type || typeof type !== 'string') {
            return res.status(400).json({ error: 'type is required' });
        }
        stateManager.broadcast(canvasId, { type, payload, canvasId });
        return res.json({ ok: true });
    });

    // Serve canvas files and inject default IPC script into HTML files.
    app.use('/:id', (req, res, next) => {
        const canvasId = req.params.id;
        const canvas = aiConfigStore.getCanvas(canvasId as any);
        if (!canvas) {
            return res.status(404).send('Canvas not found');
        }

        const canvasDir = path.join(canvasesPath, canvasId);
        const reqPath = req.path === '/' ? '/index.html' : req.path;

        if (!reqPath.endsWith('.html')) {
            return express.static(canvasDir)(req, res, next);
        }

        const decodedPath = decodeURIComponent(reqPath);
        const filePath = path.join(canvasDir, decodedPath);
        const normalizedRoot = path.resolve(canvasDir);
        const normalizedFile = path.resolve(filePath);
        if (!normalizedFile.startsWith(normalizedRoot)) {
            return res.status(400).send('Invalid path');
        }

        if (!fs.existsSync(normalizedFile)) {
            return express.static(canvasDir)(req, res, next);
        }

        try {
            let html = fs.readFileSync(normalizedFile, 'utf-8');
            if (!html.includes('id="canvas-ipc-client"')) {
                const script = createInjectedIpcScript(canvasId);
                if (html.includes('</body>')) {
                    html = html.replace('</body>', `${script}</body>`);
                } else if (html.includes('</head>')) {
                    html = html.replace('</head>', `${script}</head>`);
                } else {
                    html += script;
                }
            }

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        } catch (error) {
            logger.error(`Error serving canvas html ${canvasId}: ${error instanceof Error ? error.message : String(error)}`);
            return res.status(500).send('Internal Server Error');
        }
    });

    app.get('/', (_req, res) => {
        try {
            const indexPath = resolveWebIndexPath();
            const html = fs.readFileSync(indexPath, 'utf-8');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(html);
        } catch (error) {
            logger.error(`Index file not found for canvas server: ${error instanceof Error ? error.message : String(error)}`);
            return res.status(404).send('Not Found');
        }
    });

    return {
        listen: () => {
            return new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, bindAddress, () => {
                    server.removeListener('error', reject);
                    logger.info(`Canvas Server listening on http://${bindAddress}:${port}`);
                    resolve();
                });
            });
        },
        close: async () => {
            await stateManager.close();
            return new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
        },
        stateManager,
    };
}
