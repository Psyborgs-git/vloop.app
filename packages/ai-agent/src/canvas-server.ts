import express from 'express';
import http from 'http';
import type { Logger } from '@orch/daemon';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasStateManager } from './canvas-state-manager.js';

export interface CanvasSummary {
    id: string;
    name: string;
    description: string;
    content: string;
    owner: string;
    createdAt: string;
    updatedAt: string;
}

export interface CanvasStore {
    listCanvases(owner?: string): CanvasSummary[];
    get(id: string): CanvasSummary | undefined;
}

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
    return `\n<script id="canvas-ipc-client">\n(() => {\n  const canvasId = ${JSON.stringify(canvasId)};\n  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';\n  const wsUrl = wsProtocol + '//' + window.location.host + '${DEFAULT_IPC_PATH}?canvasId=' + encodeURIComponent(canvasId);\n\n  let socket = null;\n  let reconnectTimer = null;\n  let currentState = {};\n  const stateSubscribers = [];\n  const eventSubscribers = [];\n  const pendingDialogs = new Map();\n\n  function ensureOverlayRoot() {\n    let root = document.getElementById('__canvas-overlay-root__');\n    if (root) return root;\n\n    root = document.createElement('div');\n    root.id = '__canvas-overlay-root__';\n    root.style.position = 'fixed';\n    root.style.inset = '0';\n    root.style.pointerEvents = 'none';\n    root.style.zIndex = '2147483647';\n    root.innerHTML = [\n      '<div id="__canvas-toast-stack__" style="position:absolute;top:20px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:10px;align-items:center;max-width:min(92vw,640px);"></div>',\n      '<div id="__canvas-dialog-backdrop__" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(6,10,20,0.52);backdrop-filter:blur(2px);pointer-events:auto;">',\n      '<div id="__canvas-dialog-card__" style="width:min(92vw,520px);border-radius:16px;border:1px solid rgba(255,255,255,0.16);box-shadow:0 28px 80px rgba(0,0,0,0.45);padding:20px;background:linear-gradient(180deg, rgba(25,32,48,0.97), rgba(14,18,29,0.97));color:#f3f6ff;transform:translateY(12px) scale(0.98);opacity:0;transition:all 180ms ease;">',\n      '  <div id="__canvas-dialog-title__" style="font-size:16px;font-weight:700;letter-spacing:0.01em;"></div>',\n      '  <div id="__canvas-dialog-message__" style="margin-top:8px;font-size:14px;line-height:1.45;opacity:0.88;"></div>',\n      '  <input id="__canvas-dialog-input__" style="margin-top:14px;width:100%;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);padding:0 12px;background:rgba(255,255,255,0.08);color:#fff;outline:none;" />',\n      '  <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:10px;">',\n      '    <button id="__canvas-dialog-cancel__" style="height:36px;padding:0 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#e2e8ff;cursor:pointer;">Cancel</button>',\n      '    <button id="__canvas-dialog-confirm__" style="height:36px;padding:0 14px;border-radius:9px;border:0;background:linear-gradient(120deg,#6b7bff,#8b5cf6);color:#fff;font-weight:600;cursor:pointer;">Confirm</button>',\n      '  </div>',\n      '</div>',\n      '</div>'\n    ].join('');\n    document.body.appendChild(root);\n    return root;\n  }\n\n  function toast(payload) {\n    const root = ensureOverlayRoot();\n    const stack = root.querySelector('#__canvas-toast-stack__');\n    if (!stack) return;\n\n    const severity = payload?.severity || 'info';\n    const palette = {\n      success: 'linear-gradient(120deg,#059669,#10b981)',\n      error: 'linear-gradient(120deg,#dc2626,#ef4444)',\n      warning: 'linear-gradient(120deg,#d97706,#f59e0b)',\n      info: 'linear-gradient(120deg,#2563eb,#3b82f6)'\n    };\n\n    const item = document.createElement('div');\n    item.style.pointerEvents = 'auto';\n    item.style.padding = '10px 14px';\n    item.style.borderRadius = '12px';\n    item.style.background = palette[severity] || palette.info;\n    item.style.color = '#fff';\n    item.style.boxShadow = '0 12px 30px rgba(0,0,0,0.28)';\n    item.style.fontSize = '13px';\n    item.style.fontWeight = '600';\n    item.style.maxWidth = '100%';\n    item.style.wordBreak = 'break-word';\n    item.style.opacity = '0';\n    item.style.transform = 'translateY(-8px) scale(0.98)';\n    item.style.transition = 'all 200ms ease';\n    item.textContent = payload?.message || '';\n    stack.appendChild(item);\n\n    requestAnimationFrame(() => {\n      item.style.opacity = '1';\n      item.style.transform = 'translateY(0) scale(1)';\n    });\n\n    const durationMs = typeof payload?.durationMs === 'number' ? payload.durationMs : 3600;\n    setTimeout(() => {\n      item.style.opacity = '0';\n      item.style.transform = 'translateY(-8px) scale(0.98)';\n      setTimeout(() => item.remove(), 200);\n    }, Math.max(1200, durationMs));\n  }\n\n  function showDialog(payload) {\n    const root = ensureOverlayRoot();\n    const backdrop = root.querySelector('#__canvas-dialog-backdrop__');\n    const card = root.querySelector('#__canvas-dialog-card__');\n    const title = root.querySelector('#__canvas-dialog-title__');\n    const message = root.querySelector('#__canvas-dialog-message__');\n    const input = root.querySelector('#__canvas-dialog-input__');\n    const confirmBtn = root.querySelector('#__canvas-dialog-confirm__');\n    const cancelBtn = root.querySelector('#__canvas-dialog-cancel__');\n    if (!backdrop || !card || !title || !message || !input || !confirmBtn || !cancelBtn) return;\n\n    const requestId = payload?.requestId;\n    if (!requestId) return;\n\n    title.textContent = payload?.title || 'Input required';\n    message.textContent = payload?.message || 'Please provide input.';\n    input.placeholder = payload?.placeholder || '';\n    input.value = payload?.defaultValue || '';\n    input.type = payload?.inputType || 'text';\n    confirmBtn.textContent = payload?.confirmLabel || 'Confirm';\n    cancelBtn.textContent = payload?.cancelLabel || 'Cancel';\n\n    const cleanup = () => {\n      backdrop.style.display = 'none';\n      card.style.opacity = '0';\n      card.style.transform = 'translateY(12px) scale(0.98)';\n      confirmBtn.onclick = null;\n      cancelBtn.onclick = null;\n      pendingDialogs.delete(requestId);\n    };\n\n    const respond = (confirmed) => {\n      send('UI_DIALOG_RESPONSE', {\n        requestId,\n        confirmed,\n        value: confirmed ? String(input.value || '') : undefined,\n      });\n      cleanup();\n    };\n\n    pendingDialogs.set(requestId, { cleanup });\n    backdrop.style.display = 'flex';\n\n    requestAnimationFrame(() => {\n      card.style.opacity = '1';\n      card.style.transform = 'translateY(0) scale(1)';\n      input.focus();\n      if (input.select) input.select();\n    });\n\n    confirmBtn.onclick = () => respond(true);\n    cancelBtn.onclick = () => respond(false);\n    input.onkeydown = (event) => {\n      if (event.key === 'Enter') {\n        event.preventDefault();\n        respond(true);\n      } else if (event.key === 'Escape') {\n        event.preventDefault();\n        respond(false);\n      }\n    };\n  }\n\n  function notifyState(state) {\n    currentState = state || {};\n    stateSubscribers.forEach((cb) => {\n      try { cb(currentState); } catch (err) { console.error('CanvasState subscriber error', err); }\n    });\n  }\n\n  function notifyEvent(message) {\n    eventSubscribers.forEach((cb) => {\n      try { cb(message); } catch (err) { console.error('Canvas event subscriber error', err); }\n    });\n  }\n\n  function send(type, payload) {\n    if (!socket || socket.readyState !== WebSocket.OPEN) return false;\n    socket.send(JSON.stringify({ type, payload, canvasId }));\n    return true;\n  }\n\n  function connect() {\n    socket = new WebSocket(wsUrl);\n\n    socket.onopen = () => {\n      if (reconnectTimer) {\n        clearTimeout(reconnectTimer);\n        reconnectTimer = null;\n      }\n    };\n\n    socket.onmessage = (event) => {\n      try {\n        const message = JSON.parse(event.data);\n        if (message.type === 'INIT_STATE' || message.type === 'STATE_UPDATED') {\n          notifyState(message.payload || {});\n          return;\n        }\n        if (message.type === 'UI_TOAST') {\n          toast(message.payload || {});\n          return;\n        }\n        if (message.type === 'UI_DIALOG_REQUEST') {\n          showDialog(message.payload || {});\n          return;\n        }\n        notifyEvent(message);\n      } catch (err) {\n        console.error('Canvas IPC parse error', err);\n      }\n    };\n\n    socket.onclose = () => {\n      reconnectTimer = setTimeout(connect, 1000);\n    };\n  }\n\n  connect();\n\n  window.CanvasState = {\n    onState(callback) {\n      stateSubscribers.push(callback);\n      callback(currentState);\n    },\n    onEvent(callback) {\n      eventSubscribers.push(callback);\n    },\n    update(partialState) {\n      return send('UPDATE_STATE', partialState || {});\n    },\n    send(type, payload) {\n      return send(type, payload);\n    },\n    getState() {\n      return currentState;\n    }\n  };\n\n  window.CanvasUI = {\n    toast,\n    prompt(payload) {\n      showDialog(payload || {});\n    }\n  };\n})();\n</script>`;
}

export function createCanvasServer(
    port: number,
    bindAddress: string,
    logger: Logger,
    canvasStore: CanvasStore,
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
            const canvases = canvasStore.listCanvases();
            res.json({ canvases });
        } catch (error) {
            logger.error(`Error listing canvases: ${error instanceof Error ? error.message : String(error)}`);
            res.status(500).send('Internal Server Error');
        }
    });

    app.get('/:id/data', (req, res) => {
        try {
            const canvasId = req.params.id;
            const canvas = canvasStore.get(canvasId);

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

    app.use('/:id', (req, res, next) => {
        const canvasId = req.params.id;
        const canvas = canvasStore.get(canvasId);
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
