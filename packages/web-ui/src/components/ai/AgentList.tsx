/**
 * AgentList — CRUD list for AI agent configurations.
 */

import { useState, useEffect, useContext } from 'react';
import {
    Box, Typography, IconButton, Button, Card, CardContent, Chip, Stack,
} from '@mui/material';
import { Plus, Pencil, Trash2, Bot } from 'lucide-react';
import { ClientContext } from '../../ClientContext.js';
import { useToast } from '../ToastContext.js';
import ConfigFormDialog, { type FieldDef } from './ConfigFormDialog.js';

export default function AgentList() {
    const client = useContext(ClientContext);
    const { showToast } = useToast();
    const [agents, setAgents] = useState<any[]>([]);
    const [models, setModels] = useState<any[]>([]);
    const [tools, setTools] = useState<any[]>([]);
    const [mcpServers, setMcpServers] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    const load = async () => {
        if (!client) return;
        try {
            const [aRes, mRes, tRes, mcpRes] = await Promise.all([
                client.agent.listAgents(),
                client.agent.listModels(),
                client.agent.listTools(),
                client.agent.listMcpServers(),
            ]);
            setAgents(aRes.agents || []);
            setModels(mRes.models || []);
            setTools(tRes.tools || []);
            setMcpServers(mcpRes.mcpServers || []);
        } catch (e: any) { 
            showToast(e.message || 'Failed to load agents', 'error');
        }
    };

    useEffect(() => { load(); }, [client]);

    const fields: FieldDef[] = [
        { name: 'name', label: 'Agent Name', type: 'text', required: true },
        { name: 'description', label: 'Description', type: 'multiline' },
        { name: 'modelId', label: 'Model', type: 'select', required: true,
            options: models.map(m => ({ value: m.id, label: `${m.name} (${m.modelId})` })) },
        { name: 'systemPrompt', label: 'System Prompt', type: 'multiline' },
        { name: 'toolIds', label: 'Tools', type: 'chips',
            options: tools.map(t => ({ value: t.id, label: t.name })) },
        { name: 'mcpServerIds', label: 'MCP Servers', type: 'chips',
            options: mcpServers.map(s => ({ value: s.id, label: s.name })) },
        { name: 'params', label: 'Override Params (JSON)', type: 'json', default: '{}' },
    ];

    const modelName = (mid: string) => models.find(m => m.id === mid)?.name || mid;
    const toolName = (tid: string) => tools.find(t => t.id === tid)?.name || tid;
    const mcpServerName = (sid: string) => mcpServers.find(s => s.id === sid)?.name || sid;

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Bot size={20} /> Agents
                </Typography>
                <Button startIcon={<Plus size={16} />} variant="contained" size="small"
                    onClick={() => { setEditing(null); setDialogOpen(true); }}>
                    New Agent
                </Button>
            </Box>

            {agents.length === 0 ? (
                <Card variant="outlined"><CardContent>
                    <Typography color="text.secondary" textAlign="center">
                        No agents configured. Create a provider and model first, then create an agent.
                    </Typography>
                </CardContent></Card>
            ) : (
                <Stack spacing={1.5}>
                    {agents.map(a => (
                        <Card key={a.id} variant="outlined" sx={{ '&:hover': { borderColor: 'primary.main' }, transition: 'border-color 0.2s' }}>
                            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <Box sx={{ flex: 1 }}>
                                        <Typography fontWeight={600}>{a.name}</Typography>
                                        {a.description && (
                                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                                {a.description}
                                            </Typography>
                                        )}
                                        <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                                            <Chip label={modelName(a.modelId)} size="small" color="primary" variant="outlined" />
                                            {(a.toolIds || []).map((tid: string) => (
                                                <Chip key={tid} label={toolName(tid)} size="small" variant="outlined" />
                                            ))}
                                            {(a.mcpServerIds || []).map((sid: string) => (
                                                <Chip key={sid} label={mcpServerName(sid)} size="small" color="secondary" variant="outlined" />
                                            ))}
                                        </Box>
                                        {a.systemPrompt && (
                                            <Typography variant="caption" color="text.secondary" sx={{
                                                mt: 1, display: 'block', fontStyle: 'italic',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500,
                                            }}>
                                                "{a.systemPrompt}"
                                            </Typography>
                                        )}
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                        <IconButton size="small" onClick={() => { setEditing(a); setDialogOpen(true); }}>
                                            <Pencil size={16} />
                                        </IconButton>
                                        <IconButton size="small" color="error" onClick={async () => {
                                            if (!window.confirm('Delete agent?')) return;
                                            try {
                                                await client?.agent.deleteAgent(a.id);
                                                showToast('Agent deleted', 'success');
                                                load();
                                            } catch (e: any) {
                                                showToast(e.message || 'Failed to delete agent', 'error');
                                            }
                                        }}>
                                            <Trash2 size={16} />
                                        </IconButton>
                                    </Box>
                                </Box>
                            </CardContent>
                        </Card>
                    ))}
                </Stack>
            )}

            <ConfigFormDialog
                open={dialogOpen}
                onClose={() => { setDialogOpen(false); setEditing(null); }}
                onSubmit={async (data) => {
                    if (!client) return;
                    try {
                        if (editing) {
                            await client.agent.updateAgent(editing.id, data);
                            showToast('Agent updated', 'success');
                        } else {
                            await client.agent.createAgent(data as any);
                            showToast('Agent created', 'success');
                        }
                        load();
                    } catch (e: any) {
                        showToast(e.message || 'Failed to save agent', 'error');
                    }
                }}
                title={editing ? 'Edit Agent' : 'New Agent'}
                fields={fields}
                initialData={editing}
            />
        </Box>
    );
}
