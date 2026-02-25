import { Box, Typography, Button, CircularProgress } from '@mui/material';
import { Bot, MessageSquarePlus } from 'lucide-react';
import { ChatMode } from './types.js';

interface EmptyStateProps {
    mode: ChatMode;
    onNewChat: () => void;
    loading: boolean;
}

export function EmptyState({ mode, onNewChat, loading }: EmptyStateProps) {
    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', color: 'text.secondary',
            gap: 2, p: 4, textAlign: 'center'
        }}>
            <Bot size={48} opacity={0.2} />
            <Typography variant="h6" color="text.primary">
                {mode === 'chat' ? 'Start a new conversation' : 'Start a new agent session'}
            </Typography>
            <Typography variant="body2" sx={{ maxWidth: 400, mb: 2 }}>
                {mode === 'chat'
                    ? 'Ask questions, brainstorm ideas, or get help with your tasks using our AI models.'
                    : 'Interact with specialized AI agents designed to handle complex, multi-step workflows.'}
            </Typography>
            <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <MessageSquarePlus size={18} />}
                onClick={onNewChat}
                disabled={loading}
                sx={{ borderRadius: 2, px: 3 }}
            >
                New {mode === 'chat' ? 'Chat' : 'Session'}
            </Button>
        </Box>
    );
}
