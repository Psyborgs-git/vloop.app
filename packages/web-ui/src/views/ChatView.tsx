/**
 * ChatView — AI Agent chat with mode selection (Chat / Agent),
 * model selection grouped by provider, agent selection, and rich markdown rendering.
 */

import React, { useState, useRef, useEffect, useCallback, useContext, useMemo } from 'react';
import {
    Box, Paper, TextField, IconButton, Typography, Avatar, List, ListItem,
    ListItemButton, ListItemText, Select, MenuItem, FormControl, InputLabel,
    Chip, ListSubheader, Tooltip, CircularProgress, Collapse, Alert,
    Checkbox, FormGroup, FormControlLabel, Accordion, AccordionSummary,
    AccordionDetails, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import {
    Send, User as UserIcon, Bot, Command, Plus, MessageSquare,
    ChevronDown, Wrench, Sparkles, Cpu, MessageCircle, Wand2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ClientContext } from '../ClientContext.js';

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatMode = 'chat' | 'agent';

interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

interface ToolResult {
    callId: string;
    result: unknown;
}

interface ChatMessage {
    id?: string;
    role: 'system' | 'assistant' | 'user' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
}

interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
}

interface ProviderInfo { id: string; name: string; type: string; }
interface ModelInfo { id: string; name: string; providerId: string; modelId: string; }
interface ToolInfo { id: string; name: string; description: string; source: 'builtin' | 'config'; }
interface AgentInfo { id: string; name: string; description: string; modelId: string; }

// ─── Markdown components ─────────────────────────────────────────────────────

const mdComponents = {
    code: ({ children, className, ...rest }: any) => {
        const isBlock = className?.startsWith('language-');
        if (isBlock) {
            return (
                <Box component="pre" sx={{
                    bgcolor: 'rgba(0,0,0,0.06)', p: 1.5, borderRadius: 1, overflow: 'auto',
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: '0.85rem',
                    border: '1px solid', borderColor: 'divider', my: 1,
                }}>
                    <code className={className} {...rest}>{children}</code>
                </Box>
            );
        }
        return (
            <Box component="code" sx={{
                bgcolor: 'rgba(0,0,0,0.06)', px: 0.5, borderRadius: 0.5,
                fontFamily: 'monospace', fontSize: '0.9em',
            }}>
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

    // Chat state
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState('');
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    // Mode & selection
    const [mode, setMode] = useState<ChatMode>('chat');
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [tools, setTools] = useState<ToolInfo[]>([]);
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [selectedModelId, setSelectedModelId] = useState('');
    const [selectedAgentId, setSelectedAgentId] = useState('');
    const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

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
                const normalized = chatRes.sessions.map(s => ({ id: s.id, title: s.title, messages: [] as ChatMessage[] }));
                setSessions(normalized);
                setActiveSessionId(prev => prev || normalized[0]!.id);
            } else {
                const created = await client.agent.createChat({ title: 'New Chat', mode: 'chat' });
                setSessions([{ id: created.id, title: created.title, messages: [{ role: 'system', content: 'Select a mode and model to start chatting.' }] }]);
                setActiveSessionId(created.id);
            }
        } catch (e: any) {
            console.error('Failed to load AI configs:', e);
        }
    }, [client, selectedModelId]);

    useEffect(() => { loadConfigs(); }, [loadConfigs]);
    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeSession?.messages, loading]);

    useEffect(() => {
        if (!client || !activeSessionId) return;
        const loadHistory = async () => {
            try {
                const history = await client.agent.getChatHistory(activeSessionId);
                setSessions(prev => prev.map(s => s.id === activeSessionId
                    ? {
                        ...s,
                        messages: history.messages.length > 0
                            ? history.messages.map(m => ({ id: m.id, role: (m.role === 'assistant' ? 'assistant' : m.role) as ChatMessage['role'], content: m.content, toolCalls: m.toolCalls, toolResults: m.toolResults }))
                            : [{ role: 'system', content: 'Select a mode and model to start chatting.' }],
                    }
                    : s,
                ));
            } catch (e) {
                console.error('Failed to load chat history', e);
            }
        };
        loadHistory();
    }, [client, activeSessionId]);

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
        });
        const newSession: ChatSession = {
            id: created.id,
            title: created.title,
            messages: [{ role: 'system', content: 'New session started.' }],
        };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(created.id);
    };

    // ─── Send message ────────────────────────────────────────────────

    const handleSend = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!input.trim() || !client || !activeSession) return;
        setError(null);

        const userMsg = input.trim();
        const msgId = Date.now().toString();

        setSessions(prev => prev.map(s =>
            s.id === activeSessionId
                ? { ...s, messages: [...s.messages, { id: msgId, role: 'user', content: userMsg }] }
                : s
        ));
        setInput('');
        setLoading(true);

        const assistantMsgId = `assistant-${Date.now()}`;
        setSessions(prev => prev.map(s =>
            s.id === activeSessionId
            ? { ...s, messages: [...s.messages, { id: assistantMsgId, role: 'assistant', content: '' }] }
                : s
        ));

        try {
            let stream: AsyncGenerator<any, any, undefined>;

            if (mode === 'chat') {
                // Simple LLM chat completion
                if (!selectedModelId) { setError('Select a model.'); setLoading(false); return; }
                stream = client.agent.chatCompletionStream({ modelId: selectedModelId, prompt: userMsg, sessionId: activeSessionId });
            } else {
                // Agent mode — use invokeStream (which maps to legacy workflow) or runAgentChat
                if (selectedAgentId) {
                    // Use config-based agent
                    stream = client.agent.runAgentChat(selectedAgentId, activeSessionId, userMsg);
                } else if (selectedModelId) {
                    stream = client.agent.chatCompletionStream({ modelId: selectedModelId, prompt: userMsg, sessionId: activeSessionId });
                } else {
                    setError('Select an agent or model.'); setLoading(false); return;
                }
            }

            for await (const chunk of stream) {
                setLoading(false);
                
                if (chunk?.toolCalls) {
                    setSessions(prev => prev.map(s =>
                        s.id === activeSessionId
                            ? {
                                ...s, messages: s.messages.map(msg => msg.id === assistantMsgId ? {
                                    ...msg,
                                    toolCalls: [...(msg.toolCalls || []), ...chunk.toolCalls]
                                } : msg)
                            }
                            : s
                    ));
                    continue;
                }

                if (chunk?.toolResult) {
                    setSessions(prev => prev.map(s =>
                        s.id === activeSessionId
                            ? {
                                ...s, messages: s.messages.map(msg => msg.id === assistantMsgId ? {
                                    ...msg,
                                    toolResults: [...(msg.toolResults || []), chunk.toolResult]
                                } : msg)
                            }
                            : s
                    ));
                    continue;
                }

                const textDelta = typeof chunk === 'string' ? chunk :
                    chunk?.content?.parts?.[0]?.text ? chunk.content.parts[0].text :
                    chunk?.text ? chunk.text :
                    chunk?.content ? (typeof chunk.content === 'string' ? chunk.content : '') : '';
                if (!textDelta) continue;

                setSessions(prev => prev.map(s =>
                    s.id === activeSessionId
                        ? { ...s, messages: s.messages.map(msg => msg.id === assistantMsgId ? { ...msg, content: msg.content + textDelta } : msg) }
                        : s
                ));
            }
        } catch (err: any) {
            setSessions(prev => prev.map(s =>
                s.id === activeSessionId
                    ? { ...s, messages: [...s.messages, { id: `err-${Date.now()}`, role: 'system', content: `Error: ${err.message}` }] }
                    : s
            ));
        } finally {
            setLoading(false);
        }
    };

    const toggleTool = (id: string) => {
        setSelectedToolIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
    };

    // ─── Derived ─────────────────────────────────────────────────────

    const selectedModelInfo = models.find(m => m.id === selectedModelId);
    const selectedProviderInfo = selectedModelInfo ? providers.find(p => p.id === selectedModelInfo.providerId) : null;
    const selectedAgentInfo = agents.find(a => a.id === selectedAgentId);

    const canSend = input.trim() && !loading && client && (
        mode === 'chat' ? !!selectedModelId : (!!selectedAgentId || !!selectedModelId)
    );

    const placeholder = mode === 'chat'
        ? (selectedModelInfo ? `Chat with ${selectedModelInfo.name}...` : 'Select a model...')
        : (selectedAgentInfo ? `Ask ${selectedAgentInfo.name}...` : 'Select an agent or model...');

    // ─── Render ──────────────────────────────────────────────────────

    return (
        <Box sx={{ height: 'calc(100vh - 48px)', display: 'flex', gap: 1.5, p: 1.5 }}>
            {/* ─── Left Sidebar: Sessions ─────────────────────────────── */}
            <Paper elevation={0} sx={{ width: 240, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                    <ListItemButton onClick={handleNewChat} sx={{
                        borderRadius: 1, justifyContent: 'center', gap: 1,
                        bgcolor: 'primary.main', color: 'primary.contrastText',
                        '&:hover': { bgcolor: 'primary.dark' },
                    }}>
                        <Plus size={18} />
                        <Typography fontWeight="bold" variant="body2">New Chat</Typography>
                    </ListItemButton>
                </Box>
                <List sx={{ flexGrow: 1, overflowY: 'auto', p: 0.5 }}>
                    {sessions.map(session => (
                        <ListItem key={session.id} disablePadding>
                            <ListItemButton
                                selected={activeSessionId === session.id}
                                onClick={() => setActiveSessionId(session.id)}
                                sx={{ borderRadius: 1, py: 0.75 }}
                            >
                                <MessageSquare size={16} style={{ marginRight: 10, flexShrink: 0 }} />
                                <ListItemText
                                    primary={session.title}
                                    slotProps={{ primary: { noWrap: true, fontSize: '0.85rem', fontWeight: activeSessionId === session.id ? 'bold' : 'normal' } }}
                                />
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
            </Paper>

            {/* ─── Main Chat ──────────────────────────────────────────── */}
            <Paper elevation={0} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
                {/* Top bar */}
                <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    {/* Mode toggle */}
                    <ToggleButtonGroup
                        value={mode}
                        exclusive
                        onChange={(_, v) => v && setMode(v)}
                        size="small"
                        sx={{ height: 36 }}
                    >
                        <ToggleButton value="chat" sx={{ px: 1.5, gap: 0.5 }}>
                            <MessageCircle size={16} />
                            <Typography variant="caption" fontWeight="bold">Chat</Typography>
                        </ToggleButton>
                        <ToggleButton value="agent" sx={{ px: 1.5, gap: 0.5 }}>
                            <Wand2 size={16} />
                            <Typography variant="caption" fontWeight="bold">Agent</Typography>
                        </ToggleButton>
                    </ToggleButtonGroup>

                    <Box sx={{ flexGrow: 1 }} />

                    {/* Model selection (both modes) */}
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel id="model-sel"><Cpu size={13} style={{ marginRight: 4 }} />Model</InputLabel>
                        <Select
                            labelId="model-sel"
                            value={selectedModelId}
                            onChange={(e) => setSelectedModelId(e.target.value)}
                            label="⚡ Model"
                            renderValue={() => {
                                if (!selectedModelInfo) return 'Select';
                                return (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Typography variant="body2" noWrap>{selectedModelInfo.name}</Typography>
                                        {selectedProviderInfo && (
                                            <Chip label={selectedProviderInfo.type} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
                                        )}
                                    </Box>
                                );
                            }}
                        >
                            {modelsByProvider.length === 0 && (
                                <MenuItem disabled><Typography variant="body2" color="text.secondary">No models — sync Ollama or add a provider</Typography></MenuItem>
                            )}
                            {modelsByProvider.map(({ provider, models: pm }) => [
                                <ListSubheader key={`h-${provider.id}`} sx={{ bgcolor: 'background.paper', lineHeight: '32px' }}>
                                    <Chip label={provider.type} size="small" sx={{ mr: 1, height: 20, fontSize: '0.65rem' }} />
                                    {provider.name}
                                </ListSubheader>,
                                ...pm.map(m => (
                                    <MenuItem key={m.id} value={m.id} sx={{ pl: 4 }}>
                                        <Typography variant="body2">{m.name}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{m.modelId}</Typography>
                                    </MenuItem>
                                )),
                            ])}
                        </Select>
                    </FormControl>

                    {/* Agent selection (agent mode only) */}
                    {mode === 'agent' && (
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel id="agent-sel"><Bot size={13} style={{ marginRight: 4 }} />Agent</InputLabel>
                            <Select
                                labelId="agent-sel"
                                value={selectedAgentId}
                                onChange={(e) => setSelectedAgentId(e.target.value)}
                                label="🤖 Agent"
                            >
                                <MenuItem value="">
                                    <Typography variant="body2" color="text.secondary"><em>No agent (use model directly)</em></Typography>
                                </MenuItem>
                                {agents.map(a => (
                                    <MenuItem key={a.id} value={a.id}>
                                        <Box>
                                            <Typography variant="body2">{a.name}</Typography>
                                            {a.description && <Typography variant="caption" color="text.secondary">{a.description}</Typography>}
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}

                    {/* Tool count */}
                    <Tooltip title={`${selectedToolIds.length} tools selected`}>
                        <Chip icon={<Wrench size={14} />} label={`${selectedToolIds.length}`} size="small" variant="outlined" />
                    </Tooltip>
                </Box>

                {/* Error */}
                <Collapse in={!!error}>
                    <Alert severity="warning" onClose={() => setError(null)} sx={{ mx: 1.5, mt: 1 }}>{error}</Alert>
                </Collapse>

                {/* Messages */}
                <List sx={{ flexGrow: 1, overflowY: 'auto', p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, bgcolor: 'background.default' }}>
                    {activeSession?.messages.map((msg, i) => (
                        <ListItem key={msg.id || i} disablePadding sx={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                            <Box sx={{ display: 'flex', gap: 1.5, maxWidth: '85%', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                                <Avatar sx={{
                                    bgcolor: msg.role === 'user' ? 'primary.main' : msg.role === 'system' ? 'warning.main' : 'secondary.main',
                                    width: 36, height: 36,
                                }}>
                                    {msg.role === 'user' ? <UserIcon size={18} /> : msg.role === 'system' ? <Command size={18} /> : <Bot size={18} />}
                                </Avatar>
                                <Paper elevation={0} sx={{
                                    px: 2, py: 1.5,
                                    bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                                    color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                                    borderRadius: 2,
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
                                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                                                <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                                    {msg.toolCalls.map((tc, idx) => {
                                                        const result = msg.toolResults?.find(tr => tr.callId === tc.id || (tr as any).name === tc.name);
                                                        return (
                                                            <Accordion key={tc.id || idx} variant="outlined" disableGutters sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                                                                <AccordionSummary expandIcon={<ChevronDown size={16} />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 1 } }}>
                                                                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontFamily: 'monospace' }}>
                                                                        <Wrench size={14} /> {tc.name}
                                                                    </Typography>
                                                                </AccordionSummary>
                                                                <AccordionDetails sx={{ p: 1, pt: 0 }}>
                                                                    <Box sx={{ bgcolor: 'rgba(0,0,0,0.04)', p: 1, borderRadius: 1, mb: 1, overflowX: 'auto' }}>
                                                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Arguments:</Typography>
                                                                        <Typography variant="body2" fontFamily="monospace" sx={{ whiteSpace: 'pre-wrap' }}>
                                                                            {JSON.stringify(tc.arguments, null, 2)}
                                                                        </Typography>
                                                                    </Box>
                                                                    {result && (
                                                                        <Box sx={{ bgcolor: 'rgba(0,0,0,0.04)', p: 1, borderRadius: 1, overflowX: 'auto' }}>
                                                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Result:</Typography>
                                                                            <Typography variant="body2" fontFamily="monospace" sx={{ whiteSpace: 'pre-wrap' }}>
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
                        </ListItem>
                    ))}
                    {loading && (
                        <ListItem disablePadding>
                            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                                <Avatar sx={{ bgcolor: 'secondary.main', width: 36, height: 36 }}><Bot size={18} /></Avatar>
                                <Paper elevation={0} sx={{ px: 2, py: 1.5, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <CircularProgress size={16} />
                                    <Typography variant="body2" color="text.secondary">
                                        {mode === 'chat' ? 'Generating...' : 'Agent thinking...'}
                                    </Typography>
                                </Paper>
                            </Box>
                        </ListItem>
                    )}
                    <div ref={messagesEndRef} />
                </List>

                {/* Input */}
                <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
                    <Box component="form" onSubmit={handleSend} sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            fullWidth variant="outlined" size="small"
                            placeholder={placeholder}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading || !client}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                            multiline maxRows={4}
                            sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.default' } }}
                        />
                        <IconButton
                            color="primary" type="submit" disabled={!canSend}
                            sx={{
                                bgcolor: 'primary.main', color: 'primary.contrastText',
                                borderRadius: 2, width: 44, height: 44, alignSelf: 'flex-end',
                                '&:hover': { bgcolor: 'primary.dark' },
                                '&:disabled': { bgcolor: 'action.disabledBackground' },
                            }}
                        >
                            <Send size={20} />
                        </IconButton>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        {mode === 'chat' ? '💬 Chat mode — direct LLM completion' : '🤖 Agent mode — orchestrated with tools'}
                    </Typography>
                </Box>
            </Paper>

            {/* ─── Right Sidebar: Tools ────────────────────────────────── */}
            <Paper elevation={0} sx={{ width: 220, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                    <Typography variant="subtitle2" fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Wrench size={16} /> Tools
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {selectedToolIds.length}/{tools.length} selected
                    </Typography>
                </Box>
                <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 0.5 }}>
                    {tools.filter(t => t.source === 'builtin').length > 0 && (
                        <Accordion defaultExpanded disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
                            <AccordionSummary expandIcon={<ChevronDown size={16} />} sx={{ minHeight: 32, px: 1 }}>
                                <Typography variant="caption" fontWeight="bold" color="text.secondary">BUILT-IN</Typography>
                            </AccordionSummary>
                            <AccordionDetails sx={{ p: 0, px: 0.5 }}>
                                <FormGroup>
                                    {tools.filter(t => t.source === 'builtin').map(tool => (
                                        <Tooltip key={tool.id} title={tool.description} placement="left" arrow>
                                            <FormControlLabel
                                                control={<Checkbox size="small" checked={selectedToolIds.includes(tool.id)} onChange={() => toggleTool(tool.id)} />}
                                                label={<Typography variant="body2" noWrap>{tool.name}</Typography>}
                                                sx={{ mx: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
                                            />
                                        </Tooltip>
                                    ))}
                                </FormGroup>
                            </AccordionDetails>
                        </Accordion>
                    )}
                    {tools.filter(t => t.source === 'config').length > 0 && (
                        <Accordion defaultExpanded disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
                            <AccordionSummary expandIcon={<ChevronDown size={16} />} sx={{ minHeight: 32, px: 1 }}>
                                <Typography variant="caption" fontWeight="bold" color="text.secondary">CUSTOM</Typography>
                            </AccordionSummary>
                            <AccordionDetails sx={{ p: 0, px: 0.5 }}>
                                <FormGroup>
                                    {tools.filter(t => t.source === 'config').map(tool => (
                                        <Tooltip key={tool.id} title={tool.description} placement="left" arrow>
                                            <FormControlLabel
                                                control={<Checkbox size="small" checked={selectedToolIds.includes(tool.id)} onChange={() => toggleTool(tool.id)} />}
                                                label={<Typography variant="body2" noWrap>{tool.name}</Typography>}
                                                sx={{ mx: 0, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
                                            />
                                        </Tooltip>
                                    ))}
                                </FormGroup>
                            </AccordionDetails>
                        </Accordion>
                    )}
                    {tools.length === 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ p: 1, textAlign: 'center' }}>No tools</Typography>
                    )}
                </Box>
            </Paper>
        </Box>
    );
}
