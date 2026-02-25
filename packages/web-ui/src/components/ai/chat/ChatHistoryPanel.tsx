import { Box, ListItemButton, Typography, TextField, InputAdornment, Tooltip, IconButton, List, ListItem, ListItemText } from '@mui/material';
import { Plus, Search, SortDesc, SortAsc, MessageSquare } from 'lucide-react';
import { ChatSession } from './types.js';

interface ChatHistoryPanelProps {
    sessions: ChatSession[];
    activeSessionId: string;
    onSelectSession: (id: string) => void;
    onNewChat: () => void;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    sortDesc: boolean;
    setSortDesc: (desc: boolean | ((prev: boolean) => boolean)) => void;
}

export function ChatHistoryPanel({
    sessions, activeSessionId, onSelectSession, onNewChat,
    searchQuery, setSearchQuery, sortDesc, setSortDesc
}: ChatHistoryPanelProps) {
    const filteredSessions = [...sessions]
        .filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
        .sort((a, b) => {
            const da = new Date(a.updatedAt ?? 0).getTime();
            const db = new Date(b.updatedAt ?? 0).getTime();
            return sortDesc ? db - da : da - db;
        });

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <ListItemButton
                    onClick={onNewChat}
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
                            onClick={() => onSelectSession(session.id)}
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
}
