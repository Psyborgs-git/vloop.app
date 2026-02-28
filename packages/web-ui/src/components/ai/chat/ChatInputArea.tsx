import { Paper, TextField, Box, Tooltip, IconButton, Button, ToggleButtonGroup, ToggleButton, Typography } from '@mui/material';
import { Settings2, Cpu, Bot, Wrench, Send, Paperclip, MessageCircle, Wand2 } from 'lucide-react';
import { ChatMode, ModelInfo, AgentInfo } from './types.js';
import { useNavigate } from 'react-router-dom';

interface ChatInputAreaProps {
    input: string;
    setInput: (val: string) => void;
    onSend: () => void;
    loading: boolean;
    placeholder: string;
    canSend: boolean;
    setMode: (mode: ChatMode) => void;
    onOpenSettings: (el: HTMLButtonElement) => void;
    selectedModelInfo?: ModelInfo;
    selectedAgentInfo?: AgentInfo;
    selectedToolIds: string[];
    mode: ChatMode;
}

export function ChatInputArea({
    input, setInput, onSend, loading, placeholder, canSend, setMode, onOpenSettings,
    selectedModelInfo, selectedAgentInfo, selectedToolIds, mode
}: ChatInputAreaProps) {
    const navigate = useNavigate();

    return (
        <Paper
            elevation={0}
            sx={{
                position: 'sticky',
                bottom: 12,
                p: 1.25,
                display: 'flex', flexDirection: 'column', gap: 1,
                border: '1px solid', borderColor: 'divider', borderRadius: 3,
                transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
                mx: 'auto',
                width: '100%',
                backgroundColor: 'background.paper',
                opacity: 0.96,
                backdropFilter: 'blur(8px)',
                zIndex: 2,
                '&:focus-within': {
                    borderColor: 'primary.main',
                    boxShadow: '0 0 0 2px rgba(25,118,210,0.16), 0 10px 28px rgba(0,0,0,0.08)',
                    transform: 'translateY(-1px)',
                },
            }}>
            <TextField
                fullWidth
                variant="standard"
                placeholder={placeholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                    }
                }}
                multiline
                maxRows={6}
                InputProps={{
                    disableUnderline: true,
                    sx: { px: 1, pt: 0.5, fontSize: '0.95rem' },
                }}
            />

            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                flexWrap: 'wrap',
                px: 0.5,
            }}>
                <ToggleButtonGroup
                    value={mode}
                    exclusive
                    size="small"
                    onChange={(_, nextMode) => nextMode && setMode(nextMode)}
                    sx={{
                        '& .MuiToggleButton-root': {
                            textTransform: 'none',
                            px: 1.25,
                            py: 0.5,
                            gap: 0.75,
                            borderRadius: 1.75,
                        },
                    }}
                >
                    <ToggleButton value="chat">
                        <MessageCircle size={14} />
                        <Typography variant="caption" fontWeight={700}>Chat</Typography>
                    </ToggleButton>
                    <ToggleButton value="agent">
                        <Wand2 size={14} />
                        <Typography variant="caption" fontWeight={700}>Agent</Typography>
                    </ToggleButton>
                </ToggleButtonGroup>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={(e) => onOpenSettings(e.currentTarget as unknown as HTMLButtonElement)}
                        startIcon={<Cpu size={14} />}
                        sx={{
                            textTransform: 'none',
                            borderRadius: 999,
                            maxWidth: { xs: '100%', md: 220 },
                            '& .MuiButton-startIcon': { mr: 0.5 },
                        }}
                    >
                        {selectedModelInfo?.name ?? 'Choose model'}
                    </Button>

                    <Button
                        size="small"
                        variant={selectedToolIds.length > 0 ? 'contained' : 'outlined'}
                        color={selectedToolIds.length > 0 ? 'secondary' : 'inherit'}
                        onClick={(e) => onOpenSettings(e.currentTarget as unknown as HTMLButtonElement)}
                        startIcon={<Wrench size={14} />}
                        sx={{ textTransform: 'none', borderRadius: 999 }}
                    >
                        {selectedToolIds.length > 0
                            ? `${selectedToolIds.length} tool${selectedToolIds.length > 1 ? 's' : ''}`
                            : 'Add tools'}
                    </Button>

                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate('/media')}
                        startIcon={<Paperclip size={14} />}
                        sx={{ textTransform: 'none', borderRadius: 999 }}
                    >
                        Media
                    </Button>

                    <Tooltip title="Advanced chat settings">
                        <IconButton
                            size="small"
                            onClick={(e) => onOpenSettings(e.currentTarget)}
                            sx={{ bgcolor: 'action.hover', borderRadius: 1.5 }}
                        >
                            <Settings2 size={17} />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
                {/* Left — settings gear + quick chips */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Tooltip title="Chat settings">
                        <IconButton
                            size="small"
                            onClick={(e) => onOpenSettings(e.currentTarget)}
                            sx={{ bgcolor: 'action.hover', borderRadius: 1.5 }}
                        >
                            <Settings2 size={17} />
                        </IconButton>
                    </Tooltip>
                    
                    <Tooltip title="Attach Media/File">
                        <IconButton
                            size="small"
                            onClick={() => navigate('/media')}
                            sx={{ bgcolor: 'action.hover', borderRadius: 1.5 }}
                        >
                            <Paperclip size={17} />
                        </IconButton>
                    </Tooltip>

                    {selectedModelInfo && (
                        <Chip
                            size="small"
                            icon={<Cpu size={12} />}
                            label={selectedModelInfo.name}
                                sx: { px: 1, pt: 0.25, fontSize: '0.95rem' },
                            sx={{ height: 24, fontSize: '0.72rem', cursor: 'pointer' }}
                            onClick={(e) => onOpenSettings(e.currentTarget as unknown as HTMLButtonElement)}
                        />
                    )}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 24 }}>
                                {mode === 'agent' && selectedAgentInfo ? (
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Bot size={13} />
                                        {selectedAgentInfo.name}
                                    </Typography>
                                ) : (
                                    <Typography variant="caption" color="text.secondary">
                                        Press <strong>Enter</strong> to send · <strong>Shift+Enter</strong> for newline
                                    </Typography>
                                )}
