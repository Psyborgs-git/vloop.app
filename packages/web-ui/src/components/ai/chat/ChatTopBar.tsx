import { useMemo, useState } from 'react';
import {
    Box,
    Typography,
    Drawer,
    Dialog,
    DialogTitle,
    DialogContent,
    useMediaQuery,
    useTheme,
    IconButton,
    Tooltip,
    Chip,
} from '@mui/material';
import { History } from 'lucide-react';
import { Compress } from '@mui/icons-material';
import { ChatHistoryPanel } from './ChatHistoryPanel.js';
import { useChatController } from './ChatControllerContext.js';

export function ChatTopBar() {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const {
        sessions,
        activeSessionId,
        setActiveSessionId,
        activeSession,
        loading,
        handleNewChat,
        handleCompactContext,
    } = useChatController();

    const [historyOpen, setHistoryOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortDesc, setSortDesc] = useState(true);

    const latestCompactionMessage = useMemo(() => {
        return [...(activeSession?.messages ?? [])]
            .reverse()
            .find((m) => Boolean((m.metadata as any)?.contextCompaction));
    }, [activeSession?.messages]);

    const latestCompactionAt = (latestCompactionMessage?.metadata as any)?.compactedAt || latestCompactionMessage?.createdAt;
    const compactionDeletedCount = (latestCompactionMessage?.metadata as any)?.deletedMessages as number | undefined;

    const relativeCompactionTime = useMemo(() => {
        if (!latestCompactionAt) return '';
        const ts = new Date(latestCompactionAt).getTime();
        if (Number.isNaN(ts)) return '';
        const deltaMs = Date.now() - ts;
        const mins = Math.floor(deltaMs / 60_000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }, [latestCompactionAt]);

    const HistoryPanelContent = (
        <ChatHistoryPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            sortDesc={sortDesc}
            setSortDesc={setSortDesc}
            onNewChat={() => {
                handleNewChat();
                setHistoryOpen(false);
            }}
            onSelectSession={(id) => {
                setActiveSessionId(id);
                setHistoryOpen(false);
            }}
        />
    );

    return (
        <>
            {isMobile ? (
                <Drawer
                    anchor="left"
                    open={historyOpen}
                    onClose={() => setHistoryOpen(false)}
                    slotProps={{ paper: { sx: { width: 300 } } }}
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

            <Box
                sx={{
                    px: 2.25,
                    py: 1.5,
                    borderBottom: 1,
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    bgcolor: 'background.default',
                }}>
                <Tooltip title="Chat History">
                    <IconButton size="small" onClick={() => setHistoryOpen(true)}>
                        <History size={20} />
                    </IconButton>
                </Tooltip>
                <Typography variant="h6" fontWeight={600} noWrap sx={{ flexGrow: 1 }}>
                    {activeSession?.title ?? 'New Chat'}
                </Typography>
                {latestCompactionAt && (
                    <Tooltip title={typeof compactionDeletedCount === 'number'
                        ? `Compacted ${relativeCompactionTime}, summarized ${compactionDeletedCount} messages`
                        : `Compacted ${relativeCompactionTime}`}
                    >
                        <Chip
                            size="small"
                            label={`Compacted ${relativeCompactionTime}`}
                            color="info"
                            variant="outlined"
                            sx={{ height: 24, fontSize: '0.72rem' }}
                        />
                    </Tooltip>
                )}
                <Tooltip title="Compact context">
                    <IconButton size="small" onClick={handleCompactContext} disabled={loading}>
                        <Compress />
                    </IconButton>
                </Tooltip>
            </Box>
        </>
    );
}
