import { Paper, TextField, Box, Tooltip, IconButton, Chip } from '@mui/material';
import { Settings2, Cpu, Bot, Wrench, Send, Paperclip } from 'lucide-react';
import { ChatMode, ModelInfo, AgentInfo } from './types.js';
import { useNavigate } from 'react-router-dom';

interface ChatInputAreaProps {
    input: string;
    setInput: (val: string) => void;
    onSend: () => void;
    loading: boolean;
    placeholder: string;
    canSend: boolean;
    onOpenSettings: (el: HTMLButtonElement) => void;
    selectedModelInfo?: ModelInfo;
    selectedAgentInfo?: AgentInfo;
    selectedToolIds: string[];
    mode: ChatMode;
}

export function ChatInputArea({
    input, setInput, onSend, loading, placeholder, canSend, onOpenSettings,
    selectedModelInfo, selectedAgentInfo, selectedToolIds, mode
}: ChatInputAreaProps) {
    const navigate = useNavigate();

    return (
        <Paper
            elevation={0}
            sx={{
                position: 'absolute',
                bottom: 16,
                p: 1,
                display: 'flex', flexDirection: 'column', gap: 1,
                border: '1px solid', borderColor: 'divider', borderRadius: 3,
                transition: 'border-color 0.15s, box-shadow 0.15s',
                maxWidth: 'lg', mx: 'auto',
                width: '100%',
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
                            variant="outlined"
                            sx={{ height: 24, fontSize: '0.72rem', cursor: 'pointer' }}
                            onClick={(e) => onOpenSettings(e.currentTarget as unknown as HTMLButtonElement)}
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
                            onClick={(e) => onOpenSettings(e.currentTarget as unknown as HTMLButtonElement)}
                        />
                    )}
                    {selectedToolIds.length > 0 && (
                        <Chip
                            size="small"
                            icon={<Wrench size={12} />}
                            label={`${selectedToolIds.length} tool${selectedToolIds.length > 1 ? 's' : ''}`}
                            variant="outlined"
                            sx={{ height: 24, fontSize: '0.72rem', cursor: 'pointer' }}
                            onClick={(e) => onOpenSettings(e.currentTarget as unknown as HTMLButtonElement)}
                        />
                    )}
                </Box>

                {/* Right — send button */}
                <Tooltip title={canSend ? 'Send (Enter)' : ''}>
                    <span>
                        <IconButton
                            color="primary"
                            disabled={!canSend}
                            onClick={onSend}
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
    );
}
