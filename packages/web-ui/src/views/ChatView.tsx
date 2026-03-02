/**
 * ChatView — composable chat layout that assembles self-contained pieces.
 */
import { useContext } from 'react';
import {
    Box, Collapse, Alert,
} from '@mui/material';
import { ClientContext } from '../ClientContext.js';
import { useToast } from '../components/ToastContext.js';
import { useChat } from '../hooks/useChat.js';

import {
    ChatControllerProvider,
    ChatInputArea,
    ChatMessagesList,
    ChatTopBar,
} from '../components/ai/chat/index.js';

export default function ChatView() {
    const client = useContext(ClientContext);
    const { showToast } = useToast();
    const chat = useChat(client, showToast);

    // ─── Render ──────────────────────────────────────────────────────

    return (
        <ChatControllerProvider value={chat}>
            <Box sx={{
                height: '100%',
                display: 'flex',
                justifyContent: 'center',
                bgcolor: 'background.default',
                position: 'relative',
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
            }}>
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
                    <ChatTopBar />

                    <Collapse in={false}>
                        <Alert severity="warning" onClose={() => { }} sx={{ m: 2 }}></Alert>
                    </Collapse>

                    <ChatMessagesList />
                    <ChatInputArea />
                </Box>
            </Box>
        </ChatControllerProvider>
    );
}
