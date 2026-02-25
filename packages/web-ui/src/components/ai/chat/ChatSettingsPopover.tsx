import { Popover, Typography, ToggleButtonGroup, ToggleButton, FormControl, InputLabel, Select, MenuItem, ListSubheader, Divider, Box, FormGroup, FormControlLabel, Checkbox, Tooltip } from '@mui/material';
import { MessageCircle, Wand2 } from 'lucide-react';
import { ChatMode, ProviderInfo, ModelInfo, AgentInfo, ToolInfo } from './types.js';

interface ChatSettingsPopoverProps {
    anchorEl: HTMLButtonElement | null;
    onClose: () => void;
    mode: ChatMode;
    setMode: (mode: ChatMode) => void;
    modelsByProvider: { provider: ProviderInfo; models: ModelInfo[] }[];
    selectedModelId: string;
    setSelectedModelId: (id: string) => void;
    agents: AgentInfo[];
    selectedAgentId: string;
    setSelectedAgentId: (id: string) => void;
    tools: ToolInfo[];
    selectedToolIds: string[];
    onToolToggle: (id: string) => void;
}

export function ChatSettingsPopover({
    anchorEl, onClose, mode, setMode, modelsByProvider, selectedModelId, setSelectedModelId,
    agents, selectedAgentId, setSelectedAgentId, tools, selectedToolIds, onToolToggle
}: ChatSettingsPopoverProps) {
    const configTools = tools.filter(t => t.source === 'config');
    const builtinTools = tools.filter(t => t.source === 'builtin');

    return (
        <Popover
            open={Boolean(anchorEl)}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            PaperProps={{ sx: { p: 2.5, width: 340, borderRadius: 2.5, mt: -1 } }}
        >
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Chat Settings</Typography>

            <ToggleButtonGroup
                value={mode}
                exclusive
                onChange={(_, v) => v && setMode(v)}
                size="small"
                fullWidth
                sx={{ mb: 2.5 }}
            >
                <ToggleButton value="chat" sx={{ gap: 0.75 }}>
                    <MessageCircle size={16} /> Chat
                </ToggleButton>
                <ToggleButton value="agent" sx={{ gap: 0.75 }}>
                    <Wand2 size={16} /> Agent
                </ToggleButton>
            </ToggleButtonGroup>

            <FormControl size="small" fullWidth sx={{ mb: mode === 'agent' ? 2 : 0 }}>
                <InputLabel>Model</InputLabel>
                <Select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    label="Model"
                >
                    {modelsByProvider.map(({ provider, models: pm }) => [
                        <ListSubheader key={`h-${provider.id}`}>{provider.name}</ListSubheader>,
                        ...pm.map(m => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>),
                    ])}
                </Select>
            </FormControl>

            {mode === 'agent' && (
                <FormControl size="small" fullWidth>
                    <InputLabel>Agent</InputLabel>
                    <Select
                        value={selectedAgentId}
                        onChange={(e) => setSelectedAgentId(e.target.value)}
                        label="Agent"
                    >
                        <MenuItem value=""><em>None (use model directly)</em></MenuItem>
                        {agents.map(a => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
                    </Select>
                </FormControl>
            )}

            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
                    TOOLS
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {selectedToolIds.length} selected
                </Typography>
            </Box>

            {tools.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No tools configured</Typography>
            ) : (
                <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                    {builtinTools.length > 0 && (
                        <>
                            <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5, display: 'block', mb: 0.5 }}>
                                Built-in
                            </Typography>
                            <FormGroup sx={{ mb: 1 }}>
                                {builtinTools.map(tool => (
                                    <Tooltip key={tool.id} title={tool.description} placement="right" arrow>
                                        <FormControlLabel
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={selectedToolIds.includes(tool.id)}
                                                    onChange={() => onToolToggle(tool.id)}
                                                />
                                            }
                                            label={<Typography variant="body2" noWrap>{tool.name}</Typography>}
                                            sx={{ mx: 0 }}
                                        />
                                    </Tooltip>
                                ))}
                            </FormGroup>
                        </>
                    )}
                    {configTools.length > 0 && (
                        <>
                            <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5, display: 'block', mb: 0.5 }}>
                                Custom
                            </Typography>
                            <FormGroup>
                                {configTools.map(tool => (
                                    <Tooltip key={tool.id} title={tool.description} placement="right" arrow>
                                        <FormControlLabel
                                            control={
                                                <Checkbox
                                                    size="small"
                                                    checked={selectedToolIds.includes(tool.id)}
                                                    onChange={() => onToolToggle(tool.id)}
                                                />
                                            }
                                            label={<Typography variant="body2" noWrap>{tool.name}</Typography>}
                                            sx={{ mx: 0 }}
                                        />
                                    </Tooltip>
                                ))}
                            </FormGroup>
                        </>
                    )}
                </Box>
            )}
        </Popover>
    );
}
