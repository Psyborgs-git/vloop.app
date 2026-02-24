import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClient } from '../ClientContext.js';
import { Box, Button, Chip, IconButton, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { Plus, X, Skull, Download, Eraser } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface TerminalProfile {
    id: string;
    name: string;
    shell: string;
    cwd: string;
    args?: string[];
    env?: Record<string, string>;
}

interface TerminalTab {
    id: string;
    sessionId: string;
    title: string;
    requestId?: string;
    running: boolean;
    profileId?: string;
    term?: XTerm;
    fit?: FitAddon;
}

const termTheme = {
    background: '#0f172a',
    foreground: '#e2e8f0',
    cursor: '#f8fafc',
    cursorAccent: '#0f172a',
};

export default function TerminalView() {
    const client = useClient();
    const terminalApi = (client as any)?.terminal;
    const requestWithPersistentStream = (client as any)?.requestWithPersistentStream as
        | ((topic: string, action: string, payload: unknown, onStream: (chunk: unknown) => void) => Promise<{ requestId: string; result: unknown }>)
        | undefined;
    const terminalHostRef = useRef<HTMLDivElement | null>(null);
    const tabsRef = useRef<TerminalTab[]>([]);

    const [tabs, setTabs] = useState<TerminalTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string>('');
    const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<string>('');
    const [status, setStatus] = useState<string>('Ready');
    const [customShell, setCustomShell] = useState<string>('');
    const [customCwd, setCustomCwd] = useState<string>('');

    useEffect(() => {
        tabsRef.current = tabs;
    }, [tabs]);

    const activeTab = useMemo(
        () => tabs.find((t) => t.id === activeTabId),
        [tabs, activeTabId],
    );

    const refreshProfiles = useCallback(async () => {
        if (!client) return;
        try {
            const res = await terminalApi.listProfiles();
            const list = (res?.profiles ?? []) as TerminalProfile[];
            setProfiles(list);
            if (!selectedProfileId && list.length > 0) {
                setSelectedProfileId(list[0]!.id);
            }
        } catch (err: any) {
            setStatus(`Profile load failed: ${err.message ?? String(err)}`);
        }
    }, [selectedProfileId, terminalApi]);

    useEffect(() => {
        refreshProfiles().catch(() => undefined);
    }, [refreshProfiles]);

    const attachTerminal = useCallback((tabId: string) => {
        const host = terminalHostRef.current;
        if (!host) return;

        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (!tab) return;

        host.innerHTML = '';
        if (!tab.term || !tab.fit) return;
        tab.term.open(host);
        tab.fit.fit();

        const cols = tab.term.cols;
        const rows = tab.term.rows;
        if (terminalApi) {
            terminalApi.resize(tab.sessionId, cols, rows).catch(() => undefined);
        }
    }, [terminalApi]);

    useEffect(() => {
        if (!activeTabId) return;
        attachTerminal(activeTabId);
    }, [activeTabId, attachTerminal]);

    useEffect(() => {
        const onResize = () => {
            const tab = tabsRef.current.find((t) => t.id === activeTabId);
            if (!tab?.fit || !tab?.term || !terminalApi) return;
            tab.fit.fit();
            terminalApi.resize(tab.sessionId, tab.term.cols, tab.term.rows).catch(() => undefined);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [activeTabId, terminalApi]);

    const spawnSession = useCallback(async () => {
        if (!client || !terminalApi || !requestWithPersistentStream) return;

        const profile = profiles.find((p) => p.id === selectedProfileId);
        const sessionId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const tabId = sessionId;

        const term = new XTerm({
            theme: termTheme,
            cursorBlink: true,
            convertEol: true,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
            fontSize: 13,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());

        const nextTab: TerminalTab = {
            id: tabId,
            sessionId,
            title: profile?.name ?? `Session ${tabsRef.current.length + 1}`,
            running: true,
            profileId: profile?.id,
            term,
            fit,
        };

        term.writeln('\u001b[90mConnecting to terminal...\u001b[0m');
        term.onData((data: string) => {
            const current = tabsRef.current.find((t) => t.id === tabId);
            if (!current?.running) return;
            terminalApi.write(sessionId, data).catch(() => undefined);
        });

        setTabs((prev) => [...prev, nextTab]);
        setActiveTabId(tabId);

        queueMicrotask(() => {
            attachTerminal(tabId);
        });

        try {
            const payload = {
                sessionId,
                shell: customShell || profile?.shell || undefined,
                cwd: customCwd || profile?.cwd || undefined,
                args: profile?.args,
                env: profile?.env,
                cols: term.cols,
                rows: term.rows,
                profileId: profile?.id,
            };

            const streamResult = await requestWithPersistentStream(
                'terminal',
                'spawn',
                payload,
                (chunk: unknown) => {
                    if (!chunk || typeof chunk !== 'object') return;
                    const output = (chunk as any).data;
                    if (typeof output === 'string') {
                        term.write(output);
                    }
                    if ((chunk as any).type === 'exit') {
                        setTabs((prev) => prev.map((t) =>
                            t.id === tabId ? { ...t, running: false, title: `${t.title} (exited)` } : t,
                        ));
                    }
                },
            );

            setTabs((prev) => prev.map((t) =>
                t.id === tabId ? { ...t, requestId: streamResult.requestId } : t,
            ));
            setStatus(`Session ${sessionId} started`);
        } catch (err: any) {
            term.writeln(`\r\n\u001b[31mFailed to spawn terminal: ${err.message ?? String(err)}\u001b[0m`);
            setTabs((prev) => prev.map((t) =>
                t.id === tabId ? { ...t, running: false, title: `${t.title} (failed)` } : t,
            ));
            setStatus(`Spawn failed: ${err.message ?? String(err)}`);
        }
    }, [attachTerminal, client, customCwd, customShell, profiles, requestWithPersistentStream, selectedProfileId, terminalApi]);

    const killTab = useCallback(async (tabId: string) => {
        if (!client || !terminalApi) return;
        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (!tab) return;

        try {
            await terminalApi.kill(tab.sessionId);
        } catch {
            // no-op: session may already be dead
        }

        if (tab.requestId) {
            client.clearStreamHandler(tab.requestId);
        }

        tab.term?.dispose();

        setTabs((prev) => {
            const filtered = prev.filter((t) => t.id !== tabId);
            if (filtered.length === 0) {
                setActiveTabId('');
            } else if (activeTabId === tabId) {
                setActiveTabId(filtered[filtered.length - 1]!.id);
            }
            return filtered;
        });
    }, [activeTabId, client, terminalApi]);

    const clearActive = useCallback(() => {
        activeTab?.term?.clear();
    }, [activeTab]);

    const exportScrollback = useCallback(async () => {
        if (!terminalApi || !activeTab) return;
        try {
            const res = await terminalApi.scrollback(activeTab.sessionId);
            const text = String(res?.content ?? '');
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${activeTab.sessionId}.log`;
            a.click();
            URL.revokeObjectURL(url);
            setStatus(`Exported ${activeTab.sessionId}.log`);
        } catch (err: any) {
            setStatus(`Export failed: ${err.message ?? String(err)}`);
        }
    }, [activeTab, client]);

    useEffect(() => {
        return () => {
            for (const t of tabsRef.current) {
                if (t.requestId && client) {
                    client.clearStreamHandler(t.requestId);
                }
                t.term?.dispose();
            }
        };
    }, [client]);

    return (
        <Box sx={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Paper sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Select
                    size="small"
                    value={selectedProfileId}
                    onChange={(e) => setSelectedProfileId(e.target.value)}
                    displayEmpty
                    sx={{ minWidth: 220 }}
                >
                    <MenuItem value=""><em>No profile</em></MenuItem>
                    {profiles.map((p) => (
                        <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                    ))}
                </Select>

                <TextField
                    size="small"
                    label="Shell (optional)"
                    value={customShell}
                    onChange={(e) => setCustomShell(e.target.value)}
                    sx={{ minWidth: 180 }}
                />
                <TextField
                    size="small"
                    label="CWD (optional)"
                    value={customCwd}
                    onChange={(e) => setCustomCwd(e.target.value)}
                    sx={{ minWidth: 220 }}
                />

                <Button variant="contained" startIcon={<Plus size={16} />} onClick={spawnSession} disabled={!client}>
                    New Session
                </Button>
                <Tooltip title="Kill active session">
                    <span>
                        <IconButton onClick={() => activeTab && killTab(activeTab.id)} disabled={!activeTab}>
                            <Skull size={16} />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Clear terminal">
                    <span>
                        <IconButton onClick={clearActive} disabled={!activeTab}>
                            <Eraser size={16} />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Export scrollback">
                    <span>
                        <IconButton onClick={exportScrollback} disabled={!activeTab}>
                            <Download size={16} />
                        </IconButton>
                    </span>
                </Tooltip>

                <Chip label={status} size="small" sx={{ ml: 'auto' }} />
            </Paper>

            <Paper sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Tabs
                    value={activeTabId}
                    onChange={(_, value) => setActiveTabId(value)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 42 }}
                >
                    {tabs.map((tab) => (
                        <Tab
                            key={tab.id}
                            value={tab.id}
                            label={
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <Typography variant="caption">{tab.title}</Typography>
                                    <Chip
                                        size="small"
                                        color={tab.running ? 'success' : 'default'}
                                        label={tab.running ? 'live' : 'stopped'}
                                        sx={{ height: 16, fontSize: 10 }}
                                    />
                                    <IconButton
                                        size="small"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            killTab(tab.id).catch(() => undefined);
                                        }}
                                    >
                                        <X size={12} />
                                    </IconButton>
                                </Stack>
                            }
                            sx={{ minHeight: 42, textTransform: 'none', alignItems: 'center' }}
                        />
                    ))}
                </Tabs>

                <Box sx={{ flexGrow: 1, minHeight: 240, bgcolor: '#0f172a' }} ref={terminalHostRef} />

                {tabs.length === 0 && (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography variant="h6" gutterBottom>Terminal ready</Typography>
                        <Typography color="text.secondary">
                            Create a terminal session to start an interactive shell.
                        </Typography>
                    </Box>
                )}
            </Paper>
        </Box>
    );
}
