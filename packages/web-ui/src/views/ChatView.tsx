import React, { useState, useRef, useEffect } from 'react';

import type { OrchestratorClient } from '@orch/client';
import { Box, Paper, TextField, IconButton, Typography, Avatar, List, ListItem, ListItemButton, ListItemText, MenuItem, Select } from '@mui/material';
import { Send, User as UserIcon, Bot, Command, Plus, MessageSquare } from 'lucide-react';

interface ChatMessage {
    id?: string;
    role: 'system' | 'agent' | 'user';
    content: string;
}

interface ChatSession {
    id: string;
    title: string;
    agentRole: string;
    messages: ChatMessage[];
}

interface ChatProps {
    client: OrchestratorClient | null;
}

const AGENT_ROLES = ['default', 'researcher', 'coder', 'analyst'];

export default function ChatView({ client }: ChatProps) {
    const [sessions, setSessions] = useState<ChatSession[]>([
        {
            id: '1',
            title: 'Initial Chat',
            agentRole: 'default',
            messages: [{ role: 'system', content: 'Orchestrator Agent initialized. Awaiting commands.' }]
        }
    ]);
    const [activeSessionId, setActiveSessionId] = useState<string>('1');
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    const activeSession = sessions.find(s => s.id === activeSessionId);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [activeSession?.messages, loading]);

    const handleNewChat = () => {
        const newSession: ChatSession = {
            id: Date.now().toString(),
            title: `New Chat ${sessions.length + 1}`,
            agentRole: 'default',
            messages: [{ role: 'system', content: 'New chat created. Ready for input.' }]
        };
        setSessions([newSession, ...sessions]);
        setActiveSessionId(newSession.id);
    };

    const handleAgentRoleChange = (role: string) => {
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, agentRole: role } : s));
    };

    const handleSend = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!input.trim() || !client || !activeSession) return;

        const userMsg = input.trim();
        const msgId = Date.now().toString();

        // Update local state with user's message
        setSessions(prev => prev.map(s => {
            if (s.id === activeSessionId) {
                return { ...s, messages: [...s.messages, { id: msgId, role: 'user', content: userMsg }] };
            }
            return s;
        }));

        setInput('');
        setLoading(true);

        try {
            // Using the agentRole selected for the current session
            const stream = client.agent.invokeStream(activeSession.agentRole, userMsg);
            const agentMsgId = `agent-${Date.now()}`;

            // Add initial empty agent message
            setSessions(prev => prev.map(s => {
                if (s.id === activeSessionId) {
                    return { ...s, messages: [...s.messages, { id: agentMsgId, role: 'agent', content: '' }] };
                }
                return s;
            }));

            for await (const chunk of stream) {
                setLoading(false);

                const textDelta = typeof chunk === 'string' ? chunk :
                    chunk?.text ? chunk.text :
                    chunk?.content ? chunk.content :
                    JSON.stringify(chunk);

                setSessions(prev => prev.map(s => {
                    if (s.id === activeSessionId) {
                        return {
                            ...s,
                            messages: s.messages.map(msg =>
                                msg.id === agentMsgId ? { ...msg, content: msg.content + textDelta } : msg
                            )
                        };
                    }
                    return s;
                }));
            }
        } catch (err: any) {
            setSessions(prev => prev.map(s => {
                if (s.id === activeSessionId) {
                    return { ...s, messages: [...s.messages, { id: `err-${Date.now()}`, role: 'system', content: `Error: ${err.message}` }] };
                }
                return s;
            }));
            setLoading(false);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ height: 'calc(100vh - 48px)', display: 'flex', gap: 2, p: 2 }}>
            {/* Sidebar for Chat History */}
            <Paper elevation={0} sx={{ width: 280, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                    <ListItemButton
                        onClick={handleNewChat}
                        sx={{
                            borderRadius: 1,
                            border: '2px solid #000',
                            justifyContent: 'center',
                            gap: 1,
                            backgroundColor: 'primary.main',
                            color: 'primary.contrastText',
                            '&:hover': {
                                backgroundColor: 'primary.dark'
                            }
                        }}
                    >
                        <Plus size={20} />
                        <Typography fontWeight="bold">New Chat</Typography>
                    </ListItemButton>
                </Box>
                <List sx={{ flexGrow: 1, overflowY: 'auto', p: 1 }}>
                    {sessions.map((session) => (
                        <ListItem key={session.id} disablePadding>
                            <ListItemButton
                                selected={activeSessionId === session.id}
                                onClick={() => setActiveSessionId(session.id)}
                            >
                                <MessageSquare size={18} style={{ marginRight: 12 }} />
                                <ListItemText
                                    primary={session.title}
                                    slotProps={{ primary: { noWrap: true, fontWeight: activeSessionId === session.id ? 'bold' : 'normal' } }}
                                />
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
            </Paper>

            {/* Main Chat Area */}
            <Paper elevation={0} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
                {/* Orchestration Top Bar */}
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'background.paper' }}>
                    <Box>
                        <Typography variant="h6" fontWeight="bold">Agent Control</Typography>
                        <Typography variant="body2" color="text.secondary">Configure current orchestration</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="body2" fontWeight="bold">Active Agent:</Typography>
                        <Select
                            size="small"
                            value={activeSession?.agentRole || 'default'}
                            onChange={(e) => handleAgentRoleChange(e.target.value)}
                            sx={{ minWidth: 150, fontWeight: 'bold' }}
                        >
                            {AGENT_ROLES.map(role => (
                                <MenuItem key={role} value={role}>{role}</MenuItem>
                            ))}
                        </Select>
                    </Box>
                </Box>

                {/* Chat Messages */}
                <List sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 3, bgcolor: 'background.default' }}>
                    {activeSession?.messages.map((msg, i) => (
                        <ListItem key={msg.id || i} disablePadding sx={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                            <Box sx={{ display: 'flex', gap: 2, maxWidth: '80%', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                                <Avatar sx={{
                                    bgcolor: msg.role === 'user' ? 'primary.main' : msg.role === 'system' ? 'error.main' : 'secondary.main',
                                    width: 40, height: 40,
                                    border: '2px solid #000',
                                    boxShadow: '2px 2px 0px #000'
                                }}>
                                    {msg.role === 'user' ? <UserIcon size={20} /> : msg.role === 'system' ? <Command size={20} /> : <Bot size={20} />}
                                </Avatar>
                                <Paper elevation={0} sx={{
                                    p: 2,
                                    bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                                    color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                                    borderRadius: 2,
                                }}>
                                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{msg.content}</Typography>
                                </Paper>
                            </Box>
                        </ListItem>
                    ))}
                    {loading && (
                        <ListItem disablePadding sx={{ justifyContent: 'flex-start' }}>
                            <Box sx={{ display: 'flex', gap: 2, maxWidth: '80%' }}>
                                <Avatar sx={{ bgcolor: 'secondary.main', width: 40, height: 40, border: '2px solid #000', boxShadow: '2px 2px 0px #000' }}>
                                    <Bot size={20} />
                                </Avatar>
                                <Paper elevation={0} sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
                                    <Typography variant="body1" sx={{ animation: 'pulse 1.5s infinite opacity' }}>Thinking and Orchestrating...</Typography>
                                </Paper>
                            </Box>
                        </ListItem>
                    )}
                    <div ref={messagesEndRef} />
                </List>

                {/* Input Area */}
                <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                    <Box component="form" onSubmit={handleSend} sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            fullWidth
                            variant="outlined"
                            placeholder="Instruct the agent..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading || !client}
                            sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.default' } }}
                        />
                        <IconButton
                            color="primary"
                            type="submit"
                            disabled={loading || !input.trim() || !client}
                            sx={{
                                bgcolor: 'primary.main',
                                color: 'primary.contrastText',
                                borderRadius: 2,
                                border: '2px solid #000',
                                boxShadow: '2px 2px 0px #000',
                                width: 56,
                                height: 56,
                                '&:hover': { bgcolor: 'primary.dark' },
                                '&:disabled': { bgcolor: 'action.disabledBackground', border: '2px solid transparent', boxShadow: 'none' }
                            }}
                        >
                            <Send size={24} />
                        </IconButton>
                    </Box>
                </Box>
            </Paper>
        </Box>
    );
}
