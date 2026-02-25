import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClient } from '../ClientContext.js';
import {
    Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, Drawer, IconButton, MenuItem, Paper, Select, Stack,
    Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { Plus, X, Skull, Download, Eraser, Settings, History } from 'lucide-react';
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
    isDefault?: boolean;
}

interface SessionRecord {
    id: string;
    owner: string;
    shell: string;
    cwd: string;
    startedAt: string;
    endedAt: string | null;
    exitCode: number | null;
    logPath: string | null;
}

interface TerminalTab {
    id: string;
    sessionId: string;
    title: string;
    requestId?: string;
    running: boolean;
    profileId?: string;
    term: XTerm;
    fit: FitAddon;
    /** Whether the xterm has been opened into its host div yet. */
    opened: boolean;
}

const termTheme = {
    background: '#0f172a',
    foreground: '#e2e8f0',
    cursor: '#f8fafc',
    cursorAccent: '#0f172a',
};

// ─── Profile Form ─────────────────────────────────────────────────────────────

interface ProfileFormState {
    name: string;
    shell: string;
    cwd: string;
    args: string;
    isDefault: boolean;
}

const EMPTY_FORM: ProfileFormState = { name: '', shell: '', cwd: '', args: '', isDefault: false };

function ProfileDialog({
    open,
    initial,
    onClose,
    onSave,
}: {
    open: boolean;
    initial?: TerminalProfile;
    onClose: () => void;
    onSave: (data: ProfileFormState) => void;
}) {
    const [form, setForm] = useState<ProfileFormState>(
        initial
            ? { name: initial.name, shell: initial.shell, cwd: initial.cwd, args: (initial.args ?? []).join(' '), isDefault: initial.isDefault ?? false }
            : EMPTY_FORM,
    );

    useEffect(() => {
        setForm(initial
            ? { name: initial.name, shell: initial.shell, cwd: initial.cwd, args: (initial.args ?? []).join(' '), isDefault: initial.isDefault ?? false }
            : EMPTY_FORM);
    }, [initial, open]);

    const set = (key: keyof ProfileFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value }));

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{initial ? 'Edit Profile' : 'New Profile'}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <TextField size="small" label="Name *" value={form.name} onChange={set('name')} />
                    <TextField size="small" label="Shell" placeholder="/bin/zsh" value={form.shell} onChange={set('shell')} />
                    <TextField size="small" label="Working directory" placeholder="~" value={form.cwd} onChange={set('cwd')} />
                    <TextField size="small" label="Shell args (space-separated)" value={form.args} onChange={set('args')} />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={!form.name} onClick={() => onSave(form)}>Save</Button>
            </DialogActions>
        </Dialog>
    );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function TerminalView() {
    const client = useClient();
    const terminalApi = (client as any)?.terminal;
    const requestWithPersistentStream = (client as any)?.requestWithPersistentStream?.bind(client) as
        | ((topic: string, action: string, payload: unknown, onStream: (chunk: unknown) => void) => Promise<{ requestId: string; result: unknown }>)
        | undefined;

    // One div ref per tab — keyed by tabId
    const tabDivs = useRef<Map<string, HTMLDivElement>>(new Map());
    const tabsRef = useRef<TerminalTab[]>([]);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const termContainerRef = useRef<HTMLDivElement | null>(null);

    const [tabs, setTabs] = useState<TerminalTab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string>('');
    const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
    const [selectedProfileId, setSelectedProfileId] = useState<string>('');
    const [status, setStatus] = useState<string>('Ready');
    const [customShell, setCustomShell] = useState<string>('');
    const [customCwd, setCustomCwd] = useState<string>('');

    // Profile management dialog state
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const [editingProfile, setEditingProfile] = useState<TerminalProfile | undefined>();

    // Session history drawer
    const [historyOpen, setHistoryOpen] = useState(false);
    const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    const errorMessage = useCallback((err: unknown): string => {
        if (!err) return 'Unknown error';
        if (typeof err === 'string') return err;
        const maybe = err as { message?: string; data?: { message?: string } };
        return maybe.message ?? maybe.data?.message ?? String(err);
    }, []);

    const requestTerminal = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
        if (!client) throw new Error('Client is not connected');
        return (client as any).request('terminal', action, payload);
    }, [client]);

    useEffect(() => { tabsRef.current = tabs; }, [tabs]);

    const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId]);

    // ── Profile helpers ────────────────────────────────────────────────

    const refreshProfiles = useCallback(async () => {
        if (!terminalApi) return;
        try {
            const res = typeof terminalApi?.listProfiles === 'function'
                ? await terminalApi.listProfiles()
                : await requestTerminal('profile.list');
            const list = (res?.profiles ?? []) as TerminalProfile[];
            setProfiles(list);
            if (!selectedProfileId && list.length > 0) {
                setSelectedProfileId(list[0]!.id);
            }
        } catch (err: unknown) {
            setStatus(`Profile load failed: ${errorMessage(err)}`);
        }
    }, [selectedProfileId, terminalApi, requestTerminal, errorMessage]);

    useEffect(() => { refreshProfiles().catch(() => undefined); }, [refreshProfiles]);

    const saveProfile = useCallback(async (form: ProfileFormState) => {
        if (!terminalApi) return;
        try {
            const payload = {
                name: form.name,
                shell: form.shell || undefined,
                cwd: form.cwd || undefined,
                args: form.args ? form.args.trim().split(/\s+/) : undefined,
                isDefault: form.isDefault,
            };
            if (editingProfile) {
                if (typeof terminalApi?.updateProfile === 'function') {
                    await terminalApi.updateProfile(editingProfile.id, payload);
                } else {
                    await requestTerminal('profile.update', { id: editingProfile.id, ...payload });
                }
            } else if (typeof terminalApi?.createProfile === 'function') {
                await terminalApi.createProfile(payload);
            } else {
                await requestTerminal('profile.create', payload);
            }
            await refreshProfiles();
            setProfileDialogOpen(false);
            setEditingProfile(undefined);
        } catch (err: unknown) {
            setStatus(`Profile save failed: ${errorMessage(err)}`);
        }
    }, [editingProfile, refreshProfiles, terminalApi, requestTerminal, errorMessage]);

    const deleteProfile = useCallback(async (id: string) => {
        if (!terminalApi) return;
        try {
            if (typeof terminalApi?.deleteProfile === 'function') {
                await terminalApi.deleteProfile(id);
            } else {
                await requestTerminal('profile.delete', { id });
            }
            await refreshProfiles();
            if (selectedProfileId === id) setSelectedProfileId('');
        } catch (err: unknown) {
            setStatus(`Profile delete failed: ${errorMessage(err)}`);
        }
    }, [refreshProfiles, selectedProfileId, terminalApi, requestTerminal, errorMessage]);

    // ── xterm attach ──────────────────────────────────────────────────

    const attachTab = useCallback((tabId: string) => {
        const tab = tabsRef.current.find((t) => t.id === tabId);
        const div = tabDivs.current.get(tabId);
        if (!tab || !div) return;

        if (!tab.opened) {
            tab.term.open(div);
            // Mark opened on the ref directly to avoid state re-render
            tab.opened = true;
        }
        tab.fit.fit();

        if (typeof terminalApi?.resize === 'function') {
            terminalApi.resize(tab.sessionId, tab.term.cols, tab.term.rows).catch(() => undefined);
        } else {
            requestTerminal('resize', { sessionId: tab.sessionId, cols: tab.term.cols, rows: tab.term.rows })
                .catch(() => undefined);
        }
    }, [terminalApi, requestTerminal]);

    // Show the active tab's div and hide all others
    useEffect(() => {
        for (const [id, div] of tabDivs.current) {
            div.style.display = id === activeTabId ? 'block' : 'none';
        }
        if (activeTabId) attachTab(activeTabId);
    }, [activeTabId, attachTab]);

    // ResizeObserver — re-fit whenever the container changes size
    useEffect(() => {
        const container = termContainerRef.current;
        if (!container) return;
        const ro = new ResizeObserver(() => {
            const tab = tabsRef.current.find((t) => t.id === activeTabId);
            if (!tab?.fit || !tab?.term || !terminalApi) return;
            tab.fit.fit();
            if (typeof terminalApi?.resize === 'function') {
                terminalApi.resize(tab.sessionId, tab.term.cols, tab.term.rows).catch(() => undefined);
            } else {
                requestTerminal('resize', { sessionId: tab.sessionId, cols: tab.term.cols, rows: tab.term.rows })
                    .catch(() => undefined);
            }
        });
        ro.observe(container);
        resizeObserverRef.current = ro;
        return () => ro.disconnect();
    }, [activeTabId, terminalApi, requestTerminal]);

    // ── Spawn a new session ───────────────────────────────────────────

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
            opened: false,
        };

        term.writeln('\u001b[90mConnecting to terminal...\u001b[0m');
        term.onData((data: string) => {
            const current = tabsRef.current.find((t) => t.id === tabId);
            if (!current?.running) return;
            if (typeof terminalApi?.write === 'function') {
                terminalApi.write(sessionId, data).catch(() => undefined);
            } else {
                requestTerminal('write', { sessionId, data }).catch(() => undefined);
            }
        });

        setTabs((prev) => [...prev, nextTab]);
        setActiveTabId(tabId);

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
        } catch (err: unknown) {
            term.writeln(`\r\n\u001b[31mFailed to spawn terminal: ${errorMessage(err)}\u001b[0m`);
            setTabs((prev) => prev.map((t) =>
                t.id === tabId ? { ...t, running: false, title: `${t.title} (failed)` } : t,
            ));
            setStatus(`Spawn failed: ${errorMessage(err)}`);
        }
    }, [client, customCwd, customShell, profiles, requestWithPersistentStream, selectedProfileId, terminalApi, requestTerminal, errorMessage]);

    // ── Kill / clear / export ─────────────────────────────────────────

    const killTab = useCallback(async (tabId: string) => {
        if (!client || !terminalApi) return;
        const tab = tabsRef.current.find((t) => t.id === tabId);
        if (!tab) return;

        try {
            if (typeof terminalApi?.kill === 'function') {
                await terminalApi.kill(tab.sessionId);
            } else {
                await requestTerminal('kill', { sessionId: tab.sessionId });
            }
        } catch {
            // Already dead or transport dropped.
        }
        if (tab.requestId) client.clearStreamHandler(tab.requestId);
        tab.term.dispose();
        tabDivs.current.delete(tabId);

        setTabs((prev) => {
            const filtered = prev.filter((t) => t.id !== tabId);
            if (filtered.length === 0) setActiveTabId('');
            else if (activeTabId === tabId) setActiveTabId(filtered[filtered.length - 1]!.id);
            return filtered;
        });
    }, [activeTabId, client, terminalApi, requestTerminal]);

    const clearActive = useCallback(() => { activeTab?.term.clear(); }, [activeTab]);

    const exportScrollback = useCallback(async () => {
        if (!terminalApi || !activeTab) return;
        try {
            const res = typeof terminalApi?.scrollback === 'function'
                ? await terminalApi.scrollback(activeTab.sessionId)
                : await requestTerminal('scrollback', { sessionId: activeTab.sessionId });
            const text = String(res?.content ?? '');
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${activeTab.sessionId}.log`;
            a.click();
            URL.revokeObjectURL(url);
            setStatus(`Exported ${activeTab.sessionId}.log`);
        } catch (err: unknown) {
            setStatus(`Export failed: ${errorMessage(err)}`);
        }
    }, [activeTab, terminalApi, requestTerminal, errorMessage]);

    // ── Session history ───────────────────────────────────────────────

    const openHistory = useCallback(async () => {
        setHistoryOpen(true);
        setHistoryLoading(true);
        try {
            const res = typeof terminalApi?.listSessions === 'function'
                ? await terminalApi.listSessions()
                : await requestTerminal('session.list', {});
            setSessionHistory((res?.sessions ?? []) as SessionRecord[]);
        } catch {
            setSessionHistory([]);
        } finally {
            setHistoryLoading(false);
        }
    }, [terminalApi, requestTerminal]);

    // ── Cleanup on unmount ────────────────────────────────────────────

    useEffect(() => {
        return () => {
            for (const t of tabsRef.current) {
                if (t.requestId && client) client.clearStreamHandler(t.requestId);
                t.term.dispose();
            }
            resizeObserverRef.current?.disconnect();
        };
    }, [client]);

    // ── Render ────────────────────────────────────────────────────────

    return (
        <Box sx={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {/* Toolbar */}
            <Paper sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Select
                    size="small"
                    value={selectedProfileId}
                    onChange={(e) => setSelectedProfileId(e.target.value)}
                    displayEmpty
                    sx={{ minWidth: 200 }}
                >
                    <MenuItem value=""><em>No profile</em></MenuItem>
                    {profiles.map((p) => (
                        <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                    ))}
                </Select>

                {/* Profile CRUD buttons */}
                <Tooltip title="New profile">
                    <IconButton size="small" onClick={() => { setEditingProfile(undefined); setProfileDialogOpen(true); }}>
                        <Settings size={15} />
                    </IconButton>
                </Tooltip>
                {selectedProfileId && (
                    <>
                        <Tooltip title="Edit profile">
                            <IconButton size="small" onClick={() => {
                                const p = profiles.find((p) => p.id === selectedProfileId);
                                setEditingProfile(p);
                                setProfileDialogOpen(true);
                            }}>
                                <Settings size={15} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete profile">
                            <IconButton size="small" onClick={() => deleteProfile(selectedProfileId)}>
                                <X size={15} />
                            </IconButton>
                        </Tooltip>
                    </>
                )}

                <Divider orientation="vertical" flexItem />

                <TextField
                    size="small"
                    label="Shell override"
                    value={customShell}
                    onChange={(e) => setCustomShell(e.target.value)}
                    sx={{ minWidth: 160 }}
                />
                <TextField
                    size="small"
                    label="CWD override"
                    value={customCwd}
                    onChange={(e) => setCustomCwd(e.target.value)}
                    sx={{ minWidth: 200 }}
                />

                <Button variant="contained" startIcon={<Plus size={16} />} onClick={spawnSession} disabled={!client}>
                    New Session
                </Button>

                <Divider orientation="vertical" flexItem />

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
                <Tooltip title="Session history">
                    <IconButton onClick={openHistory}>
                        <History size={16} />
                    </IconButton>
                </Tooltip>

                <Chip label={status} size="small" sx={{ ml: 'auto' }} />
            </Paper>

            {/* Terminal panel */}
            <Paper sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Tabs
                    value={activeTabId || false}
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
                                        onClick={(e) => { e.stopPropagation(); killTab(tab.id).catch(() => undefined); }}
                                    >
                                        <X size={12} />
                                    </IconButton>
                                </Stack>
                            }
                            sx={{ minHeight: 42, textTransform: 'none', alignItems: 'center' }}
                        />
                    ))}
                </Tabs>

                {/* Container holds one div per tab; only the active one is displayed */}
                <Box
                    ref={termContainerRef}
                    sx={{ flexGrow: 1, minHeight: 0, bgcolor: '#0f172a', position: 'relative' }}
                >
                    {tabs.map((tab) => (
                        <Box
                            key={tab.id}
                            ref={(el: HTMLDivElement | null) => {
                                if (el) {
                                    tabDivs.current.set(tab.id, el);
                                    // If this is the active tab and not yet opened, attach now
                                    if (tab.id === activeTabId && !tab.opened) {
                                        // defer to next microtask so the div is in the DOM
                                        queueMicrotask(() => attachTab(tab.id));
                                    }
                                } else {
                                    tabDivs.current.delete(tab.id);
                                }
                            }}
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                display: tab.id === activeTabId ? 'block' : 'none',
                                '& .xterm': { height: '100%' },
                                '& .xterm-viewport': { overflow: 'hidden !important' },
                            }}
                        />
                    ))}

                    {tabs.length === 0 && (
                        <Box sx={{ p: 4, textAlign: 'center' }}>
                            <Typography variant="h6" gutterBottom>Terminal ready</Typography>
                            <Typography color="text.secondary">
                                Create a terminal session to start an interactive shell.
                            </Typography>
                        </Box>
                    )}
                </Box>
            </Paper>

            {/* Profile dialog */}
            <ProfileDialog
                open={profileDialogOpen}
                initial={editingProfile}
                onClose={() => { setProfileDialogOpen(false); setEditingProfile(undefined); }}
                onSave={saveProfile}
            />

            {/* Session history drawer */}
            <Drawer anchor="right" open={historyOpen} onClose={() => setHistoryOpen(false)}
                PaperProps={{ sx: { width: 420, p: 2 } }}>
                <Typography variant="h6" gutterBottom>Session History</Typography>
                {historyLoading ? (
                    <Typography color="text.secondary">Loading…</Typography>
                ) : sessionHistory.length === 0 ? (
                    <Typography color="text.secondary">No sessions recorded yet.</Typography>
                ) : (
                    <Stack spacing={1.5}>
                        {sessionHistory.map((s) => (
                            <Paper key={s.id} variant="outlined" sx={{ p: 1.5 }}>
                                <Typography variant="caption" color="text.secondary">{s.id}</Typography>
                                <Typography variant="body2" fontFamily="monospace">{s.shell}</Typography>
                                <Typography variant="body2" color="text.secondary">{s.cwd}</Typography>
                                <Stack direction="row" spacing={1} mt={0.5} alignItems="center">
                                    <Chip
                                        size="small"
                                        label={s.endedAt ? `exit ${s.exitCode ?? '?'}` : 'running'}
                                        color={s.endedAt ? 'default' : 'success'}
                                    />
                                    <Typography variant="caption" color="text.secondary">
                                        {new Date(s.startedAt).toLocaleString()}
                                    </Typography>
                                </Stack>
                            </Paper>
                        ))}
                    </Stack>
                )}
            </Drawer>
        </Box>
    );
}

