/**
 * ChatView — Sophisticated AI chat: mode/model/agent/tool selection in the input,
 * history as Drawer (mobile) or Dialog (desktop), no sidebars.
 * Tools are persisted as m2m on the session via session.tools.set.
 */
import React, { useState, useRef, useEffect, useCallback, useContext, useMemo } from 'react';
import {
    Box, Paper, TextField, IconButton, Typography, Avatar, List, ListItem,
    ListItemButton, ListItemText, Select, MenuItem, FormControl, InputLabel,
    Chip, ListSubheader, CircularProgress, Collapse, Alert,
    Checkbox, FormGroup, FormControlLabel, Accordion, AccordionSummary,
    AccordionDetails, ToggleButtonGroup, ToggleButton, Drawer, Dialog, DialogTitle, DialogContent,
    useMediaQuery, useTheme, InputAdornment, Popover, Divider, Tooltip,
} from '@mui/material';
import {
    Send, User as UserIcon, Bot, Command, Plus, MessageSquare,
    ChevronDown, Wrench, Cpu, MessageCircle, Wand2, History, Search, SortAsc, SortDesc, Settings2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ClientContext } from '../ClientContext.js';

// ─── Types ─────────────────────────────────────────────────────────────────

type ChatMode = 'chat' | 'agent';

interface ToolCall { id: string; name: string; arguments: Record<string, unknown>; }
interface ToolResult { callId: string; result: unknown; }

interface ChatMessage {
    id?: string;
    role: 'system' | 'assistant' | 'user' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    requestedToolConfirmations?: Record<string, unknown>;
    longRunningToolIds?: string[];
}

interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    toolIds: string[];
    updatedAt?: string;
}

interface ProviderInfo { id: string; name: string; type: string; }
interface ModelInfo { id: string; name: string; providerId: string; modelId: string; }
interface ToolInfo { id: string; name: string; description: string; source?: 'builtin' | 'config'; }
interface AgentInfo { id: string; name: string; description: string; modelId: string; }

// ─── Markdown renderer ───────────────────────────────────────────────────────

const mdComponents = {
    code: ({ children, className, ...rest }: any) => {
        const isBlock = className?.startsWith('language-');
        if (isBlock) return (
            <Box component="pre" sx={{
                bgcolor: 'rgba(0,0,0,0.06)', p: 1.5, borderRadius: 1, overflow: 'auto',
                fontFamily: 'monospace', fontSize: '0.85rem',
                border: '1px solid', borderColor: 'divider', my: 1,
            }}>
                <code className={className} {...rest}>{children}</code>
            </Box>
        );
        return (
            <Box component="code" sx={{ bgcolor: 'rgba(0,0,0,0.06)', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.9em' }}>
                {children}
            </Box>
        );
    },
    p: ({ children }: any) => <Typography variant="body1" sx={{ mb: 1, '&:last-child': { mb: 0 } }}>{children}</Typography>,
    h1: ({ children }: any) => <Typography variant="h5" fontWeight="bold" sx={{ mb: 1 }}>{children}</Typography>,
    h2: ({ children }: any) => <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>{children}</Typography>,
    h3: ({ children }: any) => <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 0.5 }}>{children}</Typography>,
    ul: ({ children }: any) => <Box component="ul" sx={{ pl: 2, my: 0.5 }}>{children}</Box>,
    ol: ({ children }: any) => <Box component="ol" sx={{ pl: 2, my: 0.5 }}>{children}</Box>,
    li: ({ children }: any) => <Box component="li" sx={{ mb: 0.25 }}>{children}</Box>,
    blockquote: ({ children }: any) => (
        <Box sx={{ borderLeft: '3px solid', borderColor: 'primary.main', pl: 2, my: 1, color: 'text.secondary' }}>
            {children}
        </Box>
    ),
    table: ({ children }: any) => (
        <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', my: 1, fontSize: '0.875rem' }}>
            {children}
        </Box>
    ),
    th: ({ children }: any) => (
        <Box component="th" sx={{ border: '1px solid', borderColor: 'divider', p: 1, fontWeight: 'bold', bgcolor: 'action.hover', textAlign: 'left' }}>
            {children}
        </Box>
    ),
    td: ({ children }: any) => (
        <Box component="td" sx={{ border: '1px solid', borderColor: 'divider', p: 1 }}>
            {children}
        </Box>
    ),
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChatView() {
    const client = useContext(ClientContext);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    // Chat state
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState('');
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    // Selections
    const [mode, setMode] = useState<ChatMode>('chat');
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [tools, setTools] = useState<ToolInfo[]>([]);
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [selectedModelId, setSelectedModelId] = useState('');
    const [selectedAgentId, setSelectedAgentId] = useState('');
    const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    // UI state
    const [historyOpen, setHistoryOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortDesc, setSortDesc] = useState(true);
    const [settingsAnchorEl, setSettingsAnchorEl] = useState<HTMLButtonElement | null>(null);

    const activeSession = sessions.find(s => s.id === activeSessionId);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // ─── Load configs ────────────────────────────────────────────────

    const loadConfigs = useCallback(async () => {
        if (!client) return;
        try {
            const [provRes, modRes, toolRes, agentRes, chatRes] = await Promise.all([
                client.agent.listProviders(),
                client.agent.listModels(),
                client.agent.listTools(),
                client.agent.listAgents(),
                client.agent.listChats(),
            ]);
            setProviders(provRes.providers || []);
            setModels(modRes.models || []);
            setTools(toolRes.tools || []);
            setAgents(agentRes.agents || []);
            if (!selectedModelId && modRes.models?.length > 0) {
                setSelectedModelId(modRes.models[0].id);
            }

            if (chatRes.sessions?.length > 0) {
                const normalized: ChatSession[] = (chatRes.sessions as any[]).map(s => ({
                    id: s.id, title: s.title, messages: [], toolIds: s.toolIds ?? [], updatedAt: s.updatedAt,
                }));
                setSessions(normalized);
                setActiveSessionId(prev => prev || normalized[0]!.id);
            } else {
                const created = await client.agent.createChat({ title: 'New Chat', mode: 'chat' });
                setSessions([{
                    id: created.id, title: created.title,
                    messages: [{ role: 'system', content: 'Select a mode and model to start chatting.' }],
                    toolIds: (created as any).toolIds ?? [],
                }]);
                setActiveSessionId(created.id);
            }
        } catch (e: any) {
            console.error('Failed to load AI configs:', e);
        }
    }, [client, selectedModelId]);

    useEffect(() => { loadConfigs(); }, [loadConfigs]);
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeSession?.messages, loading]);

    // Load chat history + session tools when session changes
    useEffect(() => {
        if (!client || !activeSessionId) return;
        (async () => {
            try {
                const [history, sessionToolsRes] = await Promise.all([
                    client.agent.getChatHistory(activeSessionId),
                    client.agent.getSessionTools(activeSessionId),
                ]);
                const toolIds = (sessionToolsRes.tools as any[]).map(t => t.id);
                setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                    ...s,
                    toolIds,
                    messages: history.messages.length > 0
                        ? (history.messages as any[]).map(m => ({
                            id: m.id,
                            role: m.role as ChatMessage['role'],
                            content: m.content,
                            toolCalls: m.toolCalls as ToolCall[],
                            toolResults: m.toolResults as ToolResult[],
                        }))
                        : [{ role: 'system' as const, content: 'Select a mode and model to start chatting.' }],
                }));
                setSelectedToolIds(toolIds);
            } catch (e) {
                console.error('Failed to load chat history', e);
            }
        })();
    }, [client, activeSessionId]);

    // Persist tool selection to section whenever it changes
    const persistToolSelection = useCallback(async (sessionId: string, toolIds: string[]) => {
        if (!client || !sessionId) return;
        try {
            await client.agent.setSessionTools(sessionId, toolIds);
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, toolIds } : s));
        } catch (e) {
            console.error('Failed to persist session tools', e);
        }
    }, [client]);

    // ─── Models grouped by provider ──────────────────────────────────

    const modelsByProvider = useMemo(() => {
        const groups = new Map<string, { provider: ProviderInfo; models: ModelInfo[] }>();
        for (const p of providers) groups.set(p.id, { provider: p, models: [] });
        for (const m of models) {
            const g = groups.get(m.providerId);
            if (g) g.models.push(m);
        }
        return Array.from(groups.values()).filter(g => g.models.length > 0);
    }, [providers, models]);

    // ─── Session management ──────────────────────────────────────────

    const handleNewChat = async () => {
        if (!client) return;
        const created = await client.agent.createChat({
            title: `Chat ${sessions.length + 1}`,
            mode,
            modelId: selectedModelId || undefined,
            toolIds: selectedToolIds.length > 0 ? selectedToolIds : undefined,
        });
        const newSession: ChatSession = {
            id: created.id,
            title: created.title,
            messages: [{ role: 'system', content: 'New session started.' }],
            toolIds: (created as any).toolIds ?? selectedToolIds,
            updatedAt: new Date().toISOString(),
        };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(created.id);
        setHistoryOpen(false);
    };

    // ─── Send message ────────────────────────────────────────────────

    const handleSend = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!input.trim() || !client || !activeSession) return;
        setError(null);

        const userMsg = input.trim();
        const assistantMsgId = `assistant-${Date.now()}`;

        setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
            ...s,
            messages: [
                ...s.messages,
                { id: Date.now().toString(), role: 'user' as const, content: userMsg },
                { id: assistantMsgId, role: 'assistant' as const, content: '' },
            ],
        }));
        setInput('');
        setLoading(true);

        try {
            let stream: AsyncGenerator<any, any, undefined>;

            if (mode === 'chat') {
                if (!selectedModelId) { setError('Select a model.'); setLoading(false); return; }
                stream = client.agent.chatCompletionStream({
                    modelId: selectedModelId, prompt: userMsg, sessionId: activeSessionId,
                });
            } else {
                if (selectedAgentId) {
                    stream = client.agent.runAgentChat(selectedAgentId, activeSessionId, userMsg);
                } else if (selectedModelId) {
                    stream = client.agent.chatCompletionStream({
                        modelId: selectedModelId, prompt: userMsg, sessionId: activeSessionId,
                    });
                } else {
                    setError('Select an agent or model.'); setLoading(false); return;
                }
            }

            for await (const chunk of stream) {
                setLoading(false);

                if (chunk?.toolCalls) {
                    setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                        ...s, messages: s.messages.map(msg => msg.id !== assistantMsgId ? msg : {
                            ...msg, toolCalls: [...(msg.toolCalls ?? []), ...chunk.toolCalls],
                        }),
                    }));
                    continue;
                }
                if (chunk?.toolResult) {
                    setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                        ...s, messages: s.messages.map(msg => msg.id !== assistantMsgId ? msg : {
                            ...msg, toolResults: [...(msg.toolResults ?? []), chunk.toolResult],
                        }),
                    }));
                    continue;
                }
                if (chunk?.requestedToolConfirmations || chunk?.longRunningToolIds) {
                    setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                        ...s, messages: s.messages.map(msg => msg.id !== assistantMsgId ? msg : {
                            ...msg,
                            requestedToolConfirmations: chunk.requestedToolConfirmations ?? msg.requestedToolConfirmations,
                            longRunningToolIds: chunk.longRunningToolIds ?? msg.longRunningToolIds,
                        }),
                    }));
                }

                const textDelta: string =
                    typeof chunk === 'string' ? chunk :
                    chunk?.content?.parts?.[0]?.text ??
                    chunk?.text ??
                    (typeof chunk?.content === 'string' ? chunk.content : '');
                if (!textDelta) continue;

                setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                    ...s, messages: s.messages.map(msg => msg.id !== assistantMsgId ? msg : {
                        ...msg, content: msg.content + textDelta,
                    }),
                }));
            }
        } catch (err: any) {
            setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                ...s, messages: [...s.messages, {
                    id: `err-${Date.now()}`, role: 'system' as const, content: `Error: ${err.message}`,
                }],
            }));
        } finally {
            setLoading(false);
        }
    };

    const handleToolToggle = async (id: string) => {
        const next = selectedToolIds.includes(id)
            ? selectedToolIds.filter(t => t !== id)
            : [...selectedToolIds, id];
        setSelectedToolIds(next);
        if (activeSessionId) await persistToolSelection(activeSessionId, next);
    };

    // ─── Derived ─────────────────────────────────────────────────────

    const selectedModelInfo = models.find(m => m.id === selectedModelId);
    const selectedAgentInfo = agents.find(a => a.id === selectedAgentId);

    const canSend = !!input.trim() && !loading && !!client && (
        mode === 'chat' ? !!selectedModelId : (!!selectedAgentId || !!selectedModelId)
    );

    const placeholder = mode === 'chat'
        ? (selectedModelInfo ? `Chat with ${selectedModelInfo.name}...` : 'Select a model to start...')
        : (selectedAgentInfo ? `Ask ${selectedAgentInfo.name}...` : 'Select an agent or model...');

    const filteredSessions = [...sessions]
        .filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
        .sort((a, b) => {
            const da = new Date(a.updatedAt ?? 0).getTime();
            const db = new Date(b.updatedAt ?? 0).getTime();
            return sortDesc ? db - da : da - db;
        });

    const configTools = tools.filter(t => t.source === 'config');
    const builtinTools = tools.filter(t => t.source === 'builtin');

    // ─── History panel ────────────────────────────────────────────────

    const HistoryPanel = (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <ListItemButton
                    onClick={handleNewChat}
                    sx={{
                        borderRadius: 1, justifyContent: 'center', gap: 1,
                        bgcolor: 'primary.main', color: 'primary.contrastText',
                        '&:hover': { bgcolor: 'primary.dark' },
                    }}
                >
                    <Plus size={18} />
                    <Typography fontWeight="bold" variant="body2">New Chat</Typography>
                </ListItemButton>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                        size="small"
                        placeholder="Search chats..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        fullWidth
                        InputProps={{
                            startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment>,
                        }}
                    />
                    <Tooltip title={sortDesc ? 'Newest first' : 'Oldest first'}>
                        <IconButton onClick={() => setSortDesc(d => !d)} size="small">
                            {sortDesc ? <SortDesc size={18} /> : <SortAsc size={18} />}
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>
            <List sx={{ flexGrow: 1, overflowY: 'auto', p: 1 }}>
                {filteredSessions.map(session => (
                    <ListItem key={session.id} disablePadding>
                        <ListItemButton
                            selected={activeSessionId === session.id}
                            onClick={() => { setActiveSessionId(session.id); setHistoryOpen(false); }}
                            sx={{ borderRadius: 1, py: 0.8, mb: 0.5 }}
                        >
                            <MessageSquare size={15} style={{ marginRight: 10, flexShrink: 0, opacity: 0.6 }} />
                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                <ListItemText
                                    primary={session.title}
                                    slotProps={{
                                        primary: {
                                            noWrap: true,
                                            variant: 'body2',
                                            fontWeight: activeSessionId === session.id ? 600 : 400,
                                        },
                                    }}
                                />
                                {session.toolIds.length > 0 && (
                                    <Typography variant="caption" color="text.secondary">
                                        {session.toolIds.length} tool{session.toolIds.length > 1 ? 's' : ''}
                                    </Typography>
                                )}
                            </Box>
                        </ListItemButton>
                    </ListItem>
                ))}
                {filteredSessions.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                        No chats found
                    </Typography>
                )}
            </List>
        </Box>
    );

    // ─── Render ──────────────────────────────────────────────────────

    return (
        <Box sx={{
            height: 'calc(100vh - 48px)',
            display: 'flex', justifyContent: 'center',
            p: { xs: 0, md: 2 },
            bgcolor: 'background.default',
        }}>

            {/* History Drawer (mobile) / Dialog (desktop) */}
            {isMobile ? (
                <Drawer
                    anchor="left"
                    open={historyOpen}
                    onClose={() => setHistoryOpen(false)}
                    PaperProps={{ sx: { width: 300 } }}
                >
                    {HistoryPanel}
                </Drawer>
            ) : (
                <Dialog
                    open={historyOpen}
                    onClose={() => setHistoryOpen(false)}
                    maxWidth="xs"
                    fullWidth
                >
                    <DialogTitle sx={{ pb: 0 }}>Chat History</DialogTitle>
                    <DialogContent sx={{ p: 0, height: 520, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {HistoryPanel}
                    </DialogContent>
                </Dialog>
            )}

            {/* Main Chat Card */}
            <Paper
                elevation={isMobile ? 0 : 2}
                sx={{
                    width: '100%', maxWidth: 900,
                    display: 'flex', flexDirection: 'column',
                    borderRadius: { xs: 0, md: 3 },
                    overflow: 'hidden',
                    border: { xs: 'none', md: '1px solid' },
                    borderColor: 'divider',
                }}
            >
                {/* Top bar */}
                <Box sx={{
                    px: 2, py: 1.5,
                    borderBottom: 1, borderColor: 'divider',
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    bgcolor: 'background.paper',
                }}>
                    <Tooltip title="Chat History">
                        <IconButton size="small" onClick={() => setHistoryOpen(true)}>
                            <History size={20} />
                        </IconButton>
                    </Tooltip>
                    <Typography variant="h6" fontWeight={600} noWrap sx={{ flexGrow: 1 }}>
                        {activeSession?.title ?? 'New Chat'}
                    </Typography>
                    {activeSession && activeSession.toolIds.length > 0 && (
                        <Chip
                            size="small"
                            icon={<Wrench size={12} />}
                            label={`${activeSession.toolIds.length} tool${activeSession.toolIds.length > 1 ? 's' : ''}`}
                            variant="outlined"
                            sx={{ height: 24, fontSize: '0.72rem' }}
                        />
                    )}
                </Box>

                {/* Error banner */}
                <Collapse in={!!error}>
                    <Alert severity="warning" onClose={() => setError(null)} sx={{ m: 2 }}>{error}</Alert>
                </Collapse>

                {/* Messages */}
                <List sx={{
                    flexGrow: 1, overflowY: 'auto',
                    p: { xs: 2, md: 3 },
                    display: 'flex', flexDirection: 'column', gap: 3,
                    bgcolor: 'background.default',
                }}>
                    {activeSession?.messages.map((msg, i) => (
                        <ListItem
                            key={msg.id ?? i}
                            disablePadding
                            sx={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
                        >
                            <Box sx={{
                                display: 'flex', gap: 1.5, maxWidth: '86%',
                                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                            }}>
                                <Avatar sx={{
                                    bgcolor: msg.role === 'user' ? 'primary.main' : msg.role === 'system' ? 'warning.main' : 'secondary.main',
                                    width: 32, height: 32,
                                }}>
                                    {msg.role === 'user' ? <UserIcon size={16} />
                                        : msg.role === 'system' ? <Command size={16} />
                                        : <Bot size={16} />}
                                </Avatar>
                                <Box sx={{
                                    display: 'flex', flexDirection: 'column', gap: 0.5,
                                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                                        {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'AI Assistant'}
                                    </Typography>
                                    <Paper elevation={0} sx={{
                                        px: 2.5, py: 1.5,
                                        bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                                        color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                                        borderRadius: 3,
                                        borderTopRightRadius: msg.role === 'user' ? 4 : 24,
                                        borderTopLeftRadius: msg.role !== 'user' ? 4 : 24,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                                    }}>
                                        {msg.role === 'user' ? (
                                            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{msg.content}</Typography>
                                        ) : (
                                            <Box>
                                                {msg.content && (
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                                        {msg.content}
                                                    </ReactMarkdown>
                                                )}
                                                {(msg.toolCalls?.length ?? 0) > 0 && (
                                                    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                                        {msg.toolCalls!.map((tc, idx) => {
                                                            const result = msg.toolResults?.find(
                                                                tr => tr.callId === tc.id || (tr as any).name === tc.name
                                                            );
                                                            const isLongRunning = msg.longRunningToolIds?.includes(tc.id);
                                                            const needsConfirmation = msg.requestedToolConfirmations?.[tc.id];
                                                            return (
                                                                <Accordion
                                                                    key={tc.id ?? idx}
                                                                    variant="outlined"
                                                                    disableGutters
                                                                    sx={{ bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 2, '&:before': { display: 'none' } }}
                                                                >
                                                                    <AccordionSummary
                                                                        expandIcon={<ChevronDown size={16} />}
                                                                        sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}
                                                                    >
                                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                            <Wrench size={14} />
                                                                            <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                                                                                {tc.name}
                                                                            </Typography>
                                                                            {isLongRunning && (
                                                                                <Chip label="Running…" size="small" color="info" sx={{ height: 20, fontSize: '0.65rem' }} />
                                                                            )}
                                                                            {needsConfirmation && (
                                                                                <Chip label="Confirm?" size="small" color="warning" sx={{ height: 20, fontSize: '0.65rem' }} />
                                                                            )}
                                                                        </Box>
                                                                    </AccordionSummary>
                                                                    <AccordionDetails sx={{ p: 1.5, pt: 0 }}>
                                                                        <Box sx={{ bgcolor: 'rgba(0,0,0,0.04)', p: 1.5, borderRadius: 1, mb: 1, overflowX: 'auto' }}>
                                                                            <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ display: 'block', mb: 0.5 }}>
                                                                                Arguments
                                                                            </Typography>
                                                                            <Typography variant="body2" fontFamily="monospace" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
                                                                                {JSON.stringify(tc.arguments, null, 2)}
                                                                            </Typography>
                                                                        </Box>
                                                                        {result && (
                                                                            <Box sx={{ bgcolor: 'rgba(0,0,0,0.04)', p: 1.5, borderRadius: 1, overflowX: 'auto' }}>
                                                                                <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ display: 'block', mb: 0.5 }}>
                                                                                    Result
                                                                                </Typography>
                                                                                <Typography variant="body2" fontFamily="monospace" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
                                                                                    {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
                                                                                </Typography>
                                                                            </Box>
                                                                        )}
                                                                    </AccordionDetails>
                                                                </Accordion>
                                                            );
                                                        })}
                                                    </Box>
                                                )}
                                            </Box>
                                        )}
                                    </Paper>
                                </Box>
                            </Box>
                        </ListItem>
                    ))}

                    {loading && (
                        <ListItem disablePadding>
                            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                                <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
                                    <Bot size={16} />
                                </Avatar>
                                <Paper elevation={0} sx={{
                                    px: 2.5, py: 1.5, borderRadius: 3, borderTopLeftRadius: 4,
                                    display: 'flex', alignItems: 'center', gap: 1.5,
                                    bgcolor: 'background.paper', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                                }}>
                                    <CircularProgress size={16} thickness={5} />
                                    <Typography variant="body2" color="text.secondary" fontWeight={500}>
                                        {mode === 'chat' ? 'Generating response…' : 'Agent is thinking…'}
                                    </Typography>
                                </Paper>
                            </Box>
                        </ListItem>
                    )}
                    <div ref={messagesEndRef} />
                </List>

                {/* Input Area */}
                <Box sx={{ p: 2, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
                    <Paper elevation={0} sx={{
                        p: 1,
                        display: 'flex', flexDirection: 'column', gap: 1,
                        border: '1px solid', borderColor: 'divider', borderRadius: 3,
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                        '&:focus-within': {
                            borderColor: 'primary.main',
                            boxShadow: '0 0 0 2px rgba(25,118,210,0.16)',
                        },
                    }}>
                        <TextField
                            fullWidth
                            variant="standard"
                            placeholder={placeholder}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading || !client}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            multiline
                            maxRows={6}
                            InputProps={{
                                disableUnderline: true,
                                sx: { px: 1, pt: 0.5, fontSize: '0.95rem' },
                            }}
                        />

                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
                            {/* Left — settings gear + quick chips */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                <Tooltip title="Chat settings">
                                    <IconButton
                                        size="small"
                                        onClick={(e) => setSettingsAnchorEl(e.currentTarget)}
                                        sx={{ bgcolor: 'action.hover', borderRadius: 1.5 }}
                                    >
                                        <Settings2 size={17} />
                                    </IconButton>
                                </Tooltip>

                                {selectedModelInfo && (
                                    <Chip
                                        size="small"
                                        icon={<Cpu size={12} />}
                                        label={selectedModelInfo.name}
                                        variant="outlined"
                                        sx={{ height: 24, fontSize: '0.72rem', cursor: 'pointer' }}
                                        onClick={(e) => setSettingsAnchorEl(e.currentTarget as unknown as HTMLButtonElement)}
                                    />
                                )}
                                {mode === 'agent' && selectedAgentInfo && (
                                    <Chip
                                        size="small"
                                        icon={<Bot size={12} />}
                                        label={selectedAgentInfo.name}
                                        variant="outlined"
                                        color="primary"
                                        sx={{ height: 24, fontSize: '0.72rem', cursor: 'pointer' }}
                                        onClick={(e) => setSettingsAnchorEl(e.currentTarget as unknown as HTMLButtonElement)}
                                    />
                                )}
                                {selectedToolIds.length > 0 && (
                                    <Chip
                                        size="small"
                                        icon={<Wrench size={12} />}
                                        label={`${selectedToolIds.length} tool${selectedToolIds.length > 1 ? 's' : ''}`}
                                        variant="outlined"
                                        sx={{ height: 24, fontSize: '0.72rem', cursor: 'pointer' }}
                                        onClick={(e) => setSettingsAnchorEl(e.currentTarget as unknown as HTMLButtonElement)}
                                    />
                                )}
                            </Box>

                            {/* Right — send button */}
                            <Tooltip title={canSend ? 'Send (Enter)' : ''}>
                                <span>
                                    <IconButton
                                        color="primary"
                                        disabled={!canSend}
                                        onClick={handleSend}
                                        sx={{
                                            bgcolor: canSend ? 'primary.main' : 'action.disabledBackground',
                                            color: canSend ? 'primary.contrastText' : 'action.disabled',
                                            borderRadius: 2, width: 36, height: 36,
                                            '&:hover': { bgcolor: 'primary.dark' },
                                        }}
                                    >
                                        <Send size={18} />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </Box>
                    </Paper>
                </Box>
            </Paper>

            {/* Settings Popover */}
            <Popover
                open={Boolean(settingsAnchorEl)}
                anchorEl={settingsAnchorEl}
                onClose={() => setSettingsAnchorEl(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                PaperProps={{ sx: { p: 2.5, width: 340, borderRadius: 2.5, mt: -1 } }}
            >
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Chat Settings</Typography>

                <ToggleButtonGroup
                    value={mode}
                    exclusive
                    onChange={(_, v) => v && setMode(v)}
                    size="small"
                    fullWidth
                    sx={{ mb: 2.5 }}
                >
                    <ToggleButton value="chat" sx={{ gap: 0.75 }}>
                        <MessageCircle size={16} /> Chat
                    </ToggleButton>
                    <ToggleButton value="agent" sx={{ gap: 0.75 }}>
                        <Wand2 size={16} /> Agent
                    </ToggleButton>
                </ToggleButtonGroup>

                <FormControl size="small" fullWidth sx={{ mb: mode === 'agent' ? 2 : 0 }}>
                    <InputLabel>Model</InputLabel>
                    <Select
                        value={selectedModelId}
                        onChange={(e) => setSelectedModelId(e.target.value)}
                        label="Model"
                    >
                        {modelsByProvider.map(({ provider, models: pm }) => [
                            <ListSubheader key={`h-${provider.id}`}>{provider.name}</ListSubheader>,
                            ...pm.map(m => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>),
                        ])}
                    </Select>
                </FormControl>

                {mode === 'agent' && (
                    <FormControl size="small" fullWidth>
                        <InputLabel>Agent</InputLabel>
                        <Select
                            value={selectedAgentId}
                            onChange={(e) => setSelectedAgentId(e.target.value)}
                            label="Agent"
                        >
                            <MenuItem value=""><em>None (use model directly)</em></MenuItem>
                            {agents.map(a => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
                        </Select>
                    </FormControl>
                )}

                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
                        TOOLS
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {selectedToolIds.length} selected
                    </Typography>
                </Box>

                {tools.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No tools configured</Typography>
                ) : (
                    <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {builtinTools.length > 0 && (
                            <>
                                <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5, display: 'block', mb: 0.5 }}>
                                    Built-in
                                </Typography>
                                <FormGroup sx={{ mb: 1 }}>
                                    {builtinTools.map(tool => (
                                        <Tooltip key={tool.id} title={tool.description} placement="right" arrow>
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        size="small"
                                                        checked={selectedToolIds.includes(tool.id)}
                                                        onChange={() => handleToolToggle(tool.id)}
                                                    />
                                                }
                                                label={<Typography variant="body2" noWrap>{tool.name}</Typography>}
                                                sx={{ mx: 0 }}
                                            />
                                        </Tooltip>
                                    ))}
                                </FormGroup>
                            </>
                        )}
                        {configTools.length > 0 && (
                            <>
                                <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5, display: 'block', mb: 0.5 }}>
                                    Custom
                                </Typography>
                                <FormGroup>
                                    {configTools.map(tool => (
                                        <Tooltip key={tool.id} title={tool.description} placement="right" arrow>
                                            <FormControlLabel
                                                control={
                                                    <Checkbox
                                                        size="small"
                                                        checked={selectedToolIds.includes(tool.id)}
                                                        onChange={() => handleToolToggle(tool.id)}
                                                    />
                                                }
                                                label={<Typography variant="body2" noWrap>{tool.name}</Typography>}
                                                sx={{ mx: 0 }}
                                            />
                                        </Tooltip>
                                    ))}
                                </FormGroup>
                            </>
                        )}
                    </Box>
                )}
            </Popover>
        </Box>
    );
}
