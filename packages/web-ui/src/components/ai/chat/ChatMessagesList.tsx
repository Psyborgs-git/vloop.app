import { useEffect, useRef } from 'react';
import { Box, List, ListItem, CircularProgress, Avatar, Paper, Typography } from '@mui/material';
import { Bot } from 'lucide-react';
import { EmptyState } from './EmptyState.js';
import { ChatMessageItem } from './ChatMessageItem.js';
import { useChatController } from './ChatControllerContext.js';

export function ChatMessagesList() {
    const {
        activeSession,
        mode,
        loading,
        handleNewChat,
        handleRerun,
        handleFork,
    } = useChatController();

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeSession?.messages, loading]);

    return (
        <List sx={{
            flexGrow: 1,
            overflowY: 'auto',
            p: { xs: 2, md: 3 },
            pb: { xs: 2, md: 2.5 },
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
        }}>
            {activeSession?.messages.length === 1 && activeSession.messages[0].role === 'system' ? (
                <EmptyState mode={mode} onNewChat={handleNewChat} loading={loading} />
            ) : (
                activeSession?.messages.map((msg, i) => {
                    const isGrouped = activeSession.messages[i - 1]?.role === msg.role;
                    return (
                        <ChatMessageItem
                            key={msg.id ?? i}
                            msg={msg}
                            isGrouped={isGrouped}
                            disabledActions={loading}
                            onRerun={handleRerun}
                            onFork={handleFork}
                        />
                    )
                })
            )}

            {loading && (
                <ListItem disablePadding>
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                        <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
                            <Bot size={16} />
                        </Avatar>
                        <Paper elevation={0} sx={{
                            px: 2.5,
                            py: 1.5,
                            borderRadius: 3,
                            borderTopLeftRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            bgcolor: 'background.paper',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
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
    );
}
