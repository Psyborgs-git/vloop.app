/**
 * ChatView — Sophisticated AI chat: mode/model/agent/tool selection in the input,
 * history as Drawer (mobile) or Dialog (desktop), no sidebars.
 * Tools are persisted as m2m on the session via session.tools.set.
 */
import { useState, useRef, useEffect, useContext } from 'react';
import {
    Box, Typography, List, ListItem, CircularProgress, Collapse, Alert,
    Drawer, Dialog, DialogTitle, DialogContent, useMediaQuery, useTheme,
    IconButton, Tooltip, Chip, Avatar, Paper
} from '@mui/material';
import { History, Wrench, Bot } from 'lucide-react';
import { ClientContext } from '../ClientContext.js';
import { useToast } from '../components/ToastContext.js';
import { useChat } from '../hooks/useChat.js';

import {
    ChatMessageItem, ChatHistoryPanel, ChatSettingsPopover, ChatInputArea, EmptyState
} from '../components/ai/chat/index.js';

export default function ChatView() {
    const client = useContext(ClientContext);
    const { showToast } = useToast();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const {
        sessions,
        activeSessionId,
        setActiveSessionId,
        activeSession,
        input,
        setInput,
        loading,
        mode,
        setMode,
        models,
        tools,
        agents,
        selectedModelId,
        setSelectedModelId,
        selectedAgentId,
        setSelectedAgentId,
        selectedToolIds,
        modelsByProvider,
        handleNewChat,
        handleSend,
        handleToolToggle,
    } = useChat(client, showToast);

    // UI state
    const [historyOpen, setHistoryOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortDesc, setSortDesc] = useState(true);
    const [settingsAnchorEl, setSettingsAnchorEl] = useState<HTMLButtonElement | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activeSession?.messages, loading]);

    // ─── Derived ─────────────────────────────────────────────────────

    const selectedModelInfo = models.find(m => m.id === selectedModelId);
    const selectedAgentInfo = agents.find(a => a.id === selectedAgentId);

    const canSend = !!input.trim() && !loading && !!client && (
        mode === 'chat' ? !!selectedModelId : (!!selectedAgentId || !!selectedModelId)
    );

    const placeholder = mode === 'chat'
        ? (selectedModelInfo ? `Chat with ${selectedModelInfo.name}...` : 'Select a model to start...')
        : (selectedAgentInfo ? `Ask ${selectedAgentInfo.name}...` : 'Select an agent or model...');

    // ─── History panel ────────────────────────────────────────────────

    const HistoryPanelContent = (
        <ChatHistoryPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            sortDesc={sortDesc}
            setSortDesc={setSortDesc}
            onNewChat={() => { handleNewChat(); setHistoryOpen(false); }}
            onSelectSession={(id) => { setActiveSessionId(id); setHistoryOpen(false); }}
        />
    );

    // ─── Render ──────────────────────────────────────────────────────

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            bgcolor: 'background.default',
            position: 'relative', "scrollbarWidth": "none", // Firefox
            "&::-webkit-scrollbar": { display: 'none' }, // WebKit
        }}>

            {/* History Drawer (mobile) / Dialog (desktop) */}
            {isMobile ? (
                <Drawer
                    anchor="left"
                    open={historyOpen}
                    onClose={() => setHistoryOpen(false)}
                    PaperProps={{ sx: { width: 300 } }}
                >
                    {HistoryPanelContent}
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
                        {HistoryPanelContent}
                    </DialogContent>
                </Dialog>
            )}

            {/* Main Chat Card */}
            <Box
                sx={{
                    width: '100%',
                    maxWidth: 'lg',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    bgcolor: 'transparent',
                }}
            >
                {/* Top bar */}
                <Box sx={{
                    px: 2.25, py: 1.5,
                    borderBottom: 1, borderColor: 'divider',
                    display: 'flex', alignItems: 'center', gap: 1.5,
                    bgcolor: 'background.paper',
                    borderRadius: 2, m: 1,  
                    backgroundImage: 'linear-gradient(120deg, rgba(103,80,164,0.08), rgba(25,118,210,0.03))',
                }}>
                    <Tooltip title="Chat History">
                        <IconButton size="small" onClick={() => setHistoryOpen(true)}>
                            <History size={20} />
                        </IconButton>
                    </Tooltip>
                    <Typography variant="h6" fontWeight={600} noWrap sx={{ flexGrow: 1 }}>
                        {activeSession?.title ?? 'New Chat'}
                    </Typography>
                    <Chip
                        size="small"
                        icon={<Bot size={12} />}
                        label={mode === 'agent' ? 'Agent Mode' : 'Chat Mode'}
                        color={mode === 'agent' ? 'secondary' : 'default'}
                        variant="outlined"
                        sx={{ height: 24, fontSize: '0.72rem' }}
                    />
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
                <Collapse in={false}>
                    <Alert severity="warning" onClose={() => { }} sx={{ m: 2 }}></Alert>
                </Collapse>

                {/* Messages */}
                <List sx={{
                    flexGrow: 1, overflowY: 'auto',
                    p: { xs: 2, md: 3 },
                    pb: { xs: 2, md: 2.5 },
                    display: 'flex', flexDirection: 'column', gap: 3,
                    "scrollbarWidth": "none", // Firefox
                    "&::-webkit-scrollbar": { display: 'none' }, // WebKit
                }}>
                    {activeSession?.messages.length === 1 && activeSession.messages[0].role === 'system' ? (
                        <EmptyState mode={mode} onNewChat={handleNewChat} loading={loading} />
                    ) : (
                        activeSession?.messages.map((msg, i) => (
                            <ChatMessageItem key={msg.id ?? i} msg={msg} />
                        ))
                    )}

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
                <ChatInputArea
                    input={input}
                    setInput={setInput}
                    onSend={handleSend}
                    loading={loading}
                    placeholder={placeholder}
                    canSend={canSend}
                    setMode={setMode}
                    onOpenSettings={setSettingsAnchorEl}
                    selectedModelInfo={selectedModelInfo}
                    selectedAgentInfo={selectedAgentInfo}
                    selectedToolIds={selectedToolIds}
                    mode={mode}
                />
            </Box>

            {/* Settings Popover */}
            <ChatSettingsPopover
                anchorEl={settingsAnchorEl}
                onClose={() => setSettingsAnchorEl(null)}
                mode={mode}
                setMode={setMode}
                selectedModelId={selectedModelId}
                setSelectedModelId={setSelectedModelId}
                selectedAgentId={selectedAgentId}
                setSelectedAgentId={setSelectedAgentId}
                selectedToolIds={selectedToolIds}
                onToolToggle={handleToolToggle}
                modelsByProvider={modelsByProvider}
                agents={agents}
                tools={tools}
            />
        </Box>
    );
}
