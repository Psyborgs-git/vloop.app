import { useState } from 'react';
import { TextField, Box, IconButton, Button, Typography, Menu, MenuItem, ListSubheader, FormGroup, FormControlLabel, Checkbox, CircularProgress } from '@mui/material';
import { Cpu, Bot, Wrench, Send, Plus, ChevronDown, SlidersHorizontal, Mic } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatController } from './ChatControllerContext.js';

export function ChatInputArea() {
    const navigate = useNavigate();

    const {
        input,
        setInput,
        handleSend,
        loading,
        mode,
        setMode,
        modelsByProvider,
        selectedModelId,
        setSelectedModelId,
        agents,
        selectedAgentId,
        setSelectedAgentId,
        tools,
        selectedToolIds,
        handleToolToggle,
        handleNewChat,
        models,
    } = useChatController();

    const [modeMenuAnchor, setModeMenuAnchor] = useState<null | HTMLElement>(null);
    const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);
    const [agentMenuAnchor, setAgentMenuAnchor] = useState<null | HTMLElement>(null);
    const [toolsMenuAnchor, setToolsMenuAnchor] = useState<null | HTMLElement>(null);

    const builtinTools = tools.filter(t => t.source === 'builtin');
    const configTools = tools.filter(t => t.source === 'config');
    const modeLabel = mode === 'agent' ? 'Agent' : 'Chat';

    const selectedModelInfo = models.find(m => m.id === selectedModelId);
    const selectedAgentInfo = agents.find(a => a.id === selectedAgentId);

    const modelLabel = selectedModelInfo?.name ?? 'Model';
    const agentLabel = selectedAgentInfo?.name ?? 'No Agent';

    const canSend = !!input.trim() && !loading && (
        mode === 'chat' ? !!selectedModelId : (!!selectedAgentId || !!selectedModelId)
    );

    const placeholder = mode === 'chat'
        ? (selectedModelInfo ? `Chat with ${selectedModelInfo.name}...` : 'Select a model to start...')
        : (selectedAgentInfo ? `Ask ${selectedAgentInfo.name}...` : 'Select an agent or model...');

    return (
        <Box
            sx={{
                position: 'sticky', bottom: 12, p: 1.1,
                display: 'flex', flexDirection: 'column', gap: 1,
                border: '1px solid', borderColor: 'divider', borderRadius: 2,
                transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
                mx: 'auto', width: '100%',
                overflow: "auto",
                backgroundColor: 'background.paper', opacity: 0.96, backdropFilter: 'blur(8px)', zIndex: 2,
                '&:focus-within': {
                    borderColor: 'primary.main',
                    boxShadow: '0 0 0 2px rgba(25,118,210,0.16), 0 10px 28px rgba(0,0,0,0.08)',
                    transform: 'translateY(-1px)',
                },
            }}>
            <TextField
                fullWidth variant="standard" placeholder={placeholder || 'Describe what to build next'}
                value={input} onChange={(e) => setInput(e.target.value)} disabled={loading}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
                }}
                multiline maxRows={6}
                slotProps={{
                    "input": { disableUnderline: true, sx: { px: 0.75, pt: 0.35, fontSize: '0.95rem' } }
                }}
            />

            <Box
                sx={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                    px: 0.25, py: 0.1,
                }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, flexWrap: 'wrap' }}>
                    <IconButton size="small" onClick={() => void handleNewChat()} sx={{ borderRadius: 1.2 }}>
                        <Plus size={16} />
                    </IconButton>

                    <Button
                        size="small"
                        variant='text'
                        startIcon={<Bot size={13} />}
                        endIcon={<ChevronDown size={12} />}
                        onClick={(e) => setModeMenuAnchor(e.currentTarget)}
                        sx={{ textTransform: 'none', borderRadius: 1.3, px: 1, minWidth: 0, boxShadow: "none", border: "none" }}
                    >
                        {modeLabel}
                    </Button>

                    <Button
                        size="small"
                        variant='text'
                        startIcon={<Cpu size={13} />}
                        endIcon={<ChevronDown size={12} />}
                        onClick={(e) => setModelMenuAnchor(e.currentTarget)}
                        sx={{ textTransform: 'none', borderRadius: 1.3, px: 1, minWidth: 0, maxWidth: 210, boxShadow: "none", border: "none" }}
                    >
                        <Typography variant="caption" noWrap>{modelLabel}</Typography>
                    </Button>

                    {mode === 'agent' && (
                        <Button
                            size="small"
                            variant='text'
                            startIcon={<Wrench size={13} />}
                            endIcon={<ChevronDown size={12} />}
                            onClick={(e) => setAgentMenuAnchor(e.currentTarget)}
                            sx={{ textTransform: 'none', borderRadius: 1.3, px: 1, minWidth: 0, maxWidth: 180, boxShadow: "none", border: "none" }}
                        >
                            <Typography variant="caption" noWrap>{agentLabel}</Typography>
                        </Button>
                    )}

                    <IconButton size="small" onClick={(e) => setToolsMenuAnchor(e.currentTarget)}>
                        <SlidersHorizontal size={15} />
                    </IconButton>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {loading && <CircularProgress size={15} thickness={5} />}
                    <IconButton size="small" disabled>
                        <Mic size={15} />
                    </IconButton>
                    <IconButton size="small" color="primary" onClick={() => void handleSend()} disabled={!canSend} sx={{ bgcolor: canSend ? 'primary.main' : 'action.disabledBackground', color: canSend ? 'primary.contrastText' : 'action.disabled', borderRadius: 2, p: 0.75, transition: 'all 0.2s', '&:hover': { bgcolor: 'primary.dark', transform: 'scale(1.05)' } }}>
                        <Send size={16} />
                    </IconButton>
                </Box>
            </Box>

            <Menu anchorEl={modeMenuAnchor} open={Boolean(modeMenuAnchor)} onClose={() => setModeMenuAnchor(null)} anchorOrigin={{vertical: "top", horizontal: "right"}} >
                <MenuItem selected={mode === 'chat'} onClick={() => { setMode('chat'); setModeMenuAnchor(null); }}>
                    Chat
                </MenuItem>
                <MenuItem selected={mode === 'agent'} onClick={() => { setMode('agent'); setModeMenuAnchor(null); }}>
                    Agent
                </MenuItem>
            </Menu>

            <Menu anchorEl={modelMenuAnchor} open={Boolean(modelMenuAnchor)} onClose={() => setModelMenuAnchor(null)} anchorOrigin={{vertical: "top", horizontal: "right"}} slotProps={{paper: { sx: { width: 300, maxHeight: 400 } }}}>
                {modelsByProvider.map(({ provider, models: pm }) => [
                    <ListSubheader key={`h-${provider.id}`}>{provider.name}</ListSubheader>,
                    ...pm.map(m => (
                        <MenuItem key={m.id} selected={m.id === selectedModelId} onClick={() => { setSelectedModelId(m.id); setModelMenuAnchor(null); }}>
                            <Typography variant="body2">{m.name}</Typography>
                        </MenuItem>
                    ))
                ])}
            </Menu>

            <Menu anchorEl={agentMenuAnchor} open={Boolean(agentMenuAnchor)} onClose={() => setAgentMenuAnchor(null)} anchorOrigin={{vertical: "top", horizontal: "right"}} slotProps={{paper: { sx: { width: 300, maxHeight: 400 } }}}>
                <MenuItem value="" onClick={() => { setSelectedAgentId(''); setAgentMenuAnchor(null); }}>
                    <em>None (use model directly)</em>
                </MenuItem>
                {agents.map(a => (
                    <MenuItem key={a.id} selected={a.id === selectedAgentId} onClick={() => { setSelectedAgentId(a.id); setAgentMenuAnchor(null); }}>
                        <Typography variant="body2">{a.name}</Typography>
                    </MenuItem>
                ))}
            </Menu>

            <Menu anchorEl={toolsMenuAnchor} open={Boolean(toolsMenuAnchor)} onClose={() => setToolsMenuAnchor(null)} anchorOrigin={{vertical: "top", horizontal: "right"}} slotProps={{paper: { sx: { width: 300, maxHeight: 400 } }}}>
                {tools.length === 0 ? (
                    <MenuItem disabled><Typography variant="body2" color="text.secondary">No tools configured</Typography></MenuItem>
                ) : (
                    <Box sx={{ p: 1 }}>
                        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1, ml: 1 }}>SELECT TOOLS</Typography>
                        {builtinTools.length > 0 && (
                            <>
                                <ListSubheader sx={{ lineHeight: '32px' }}>Built-in</ListSubheader>
                                <FormGroup sx={{ px: 2 }}>
                                    {builtinTools.map(tool => (
                                        <FormControlLabel
                                            key={tool.id}
                                            control={<Checkbox size="small" checked={selectedToolIds.includes(tool.id)} onChange={() => void handleToolToggle(tool.id)} />}
                                            label={<Typography variant="body2" noWrap>{tool.name}</Typography>}
                                            sx={{ mx: 0 }}
                                        />
                                    ))}
                                </FormGroup>
                            </>
                        )}
                        {configTools.length > 0 && (
                            <>
                                <ListSubheader sx={{ lineHeight: '32px' }}>Configured</ListSubheader>
                                <FormGroup sx={{ px: 2 }}>
                                    {configTools.map(tool => (
                                        <FormControlLabel
                                            key={tool.id}
                                            control={<Checkbox size="small" checked={selectedToolIds.includes(tool.id)} onChange={() => void handleToolToggle(tool.id)} />}
                                            label={<Typography variant="body2" noWrap>{tool.name}</Typography>}
                                            sx={{ mx: 0 }}
                                        />
                                    ))}
                                </FormGroup>
                            </>
                        )}
                        <MenuItem onClick={() => { setToolsMenuAnchor(null); navigate('/media'); }}>
                            Open Media
                        </MenuItem>
                    </Box>
                )}
            </Menu>
        </Box>
    );
}
