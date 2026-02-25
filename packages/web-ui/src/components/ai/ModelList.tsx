/**
 * ModelList — CRUD list for AI model configurations.
 */

import { useState, useEffect, useContext } from 'react';
import {
    Box, Typography, IconButton, Button, Card, CardContent, Chip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import { Plus, Pencil, Trash2, Cpu } from 'lucide-react';
import { ClientContext } from '../../ClientContext.js';
import { useToast } from '../ToastContext.js';
import ConfigFormDialog, { type FieldDef } from './ConfigFormDialog.js';

export default function ModelList() {
    const client = useContext(ClientContext);
    const { showToast } = useToast();
    const [models, setModels] = useState<any[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    const load = async () => {
        if (!client) return;
        try {
            const [mRes, pRes] = await Promise.all([
                client.agent.listModels(),
                client.agent.listProviders(),
            ]);
            setModels(mRes.models || []);
            setProviders(pRes.providers || []);
        } catch (e: any) { 
            showToast(e.message || 'Failed to load models', 'error');
        }
    };

    useEffect(() => { load(); }, [client]);

    const fields: FieldDef[] = [
        { name: 'name', label: 'Display Name', type: 'text', required: true },
        { name: 'providerId', label: 'Provider', type: 'select', required: true,
            options: providers.map(p => ({ value: p.id, label: `${p.name} (${p.type})` })) },
        { name: 'modelId', label: 'Model ID (e.g. gemini-2.5-flash)', type: 'text', required: true },
        { name: 'runtime', label: 'Runtime', type: 'select', options: [
            { value: 'chat', label: 'Chat' },
            { value: 'agent', label: 'Agent' },
            { value: 'workflow', label: 'Workflow' },
        ] },
        { name: 'supportsTools', label: 'Supports Tools (true/false)', type: 'select', options: [
            { value: 'true', label: 'true' },
            { value: 'false', label: 'false' },
        ] },
        { name: 'supportsStreaming', label: 'Supports Streaming (true/false)', type: 'select', options: [
            { value: 'true', label: 'true' },
            { value: 'false', label: 'false' },
        ] },
        { name: 'params', label: 'Parameters (JSON)', type: 'json', default: '{"temperature": 0.7, "maxTokens": 4096}' },
    ];

    const providerName = (pid: string) => providers.find(p => p.id === pid)?.name || pid;

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Cpu size={20} /> Models
                </Typography>
                <Button startIcon={<Plus size={16} />} variant="contained" size="small"
                    onClick={() => { setEditing(null); setDialogOpen(true); }}>
                    Add Model
                </Button>
            </Box>

            {models.length === 0 ? (
                <Card variant="outlined"><CardContent>
                    <Typography color="text.secondary" textAlign="center">
                        No models configured. Add a provider first, then add models.
                    </Typography>
                </CardContent></Card>
            ) : (
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Provider</TableCell>
                                <TableCell>Model ID</TableCell>
                                <TableCell>Temperature</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {models.map(m => (
                                <TableRow key={m.id} hover>
                                    <TableCell><Typography fontWeight={500}>{m.name}</Typography></TableCell>
                                    <TableCell><Chip label={providerName(m.providerId)} size="small" variant="outlined" /></TableCell>
                                    <TableCell><Typography variant="body2" fontFamily="monospace">{m.modelId}</Typography></TableCell>
                                    <TableCell>{m.params?.temperature ?? '—'}</TableCell>
                                    <TableCell align="right">
                                        <IconButton size="small" onClick={() => { setEditing(m); setDialogOpen(true); }}>
                                            <Pencil size={16} />
                                        </IconButton>
                                        <IconButton size="small" color="error" onClick={async () => {
                                            if (!window.confirm('Delete model?')) return;
                                            try {
                                                await client?.agent.deleteModel(m.id);
                                                showToast('Model deleted', 'success');
                                                load();
                                            } catch (e: any) {
                                                showToast(e.message || 'Failed to delete model', 'error');
                                            }
                                        }}>
                                            <Trash2 size={16} />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <ConfigFormDialog
                open={dialogOpen}
                onClose={() => { setDialogOpen(false); setEditing(null); }}
                onSubmit={async (data) => {
                    if (!client) return;
                    try {
                        const normalized = {
                            ...data,
                            supportsTools: typeof data.supportsTools === 'string' ? data.supportsTools === 'true' : data.supportsTools,
                            supportsStreaming: typeof data.supportsStreaming === 'string' ? data.supportsStreaming === 'true' : data.supportsStreaming,
                        };
                        if (editing) {
                            await client.agent.updateModel(editing.id, normalized);
                            showToast('Model updated', 'success');
                        } else {
                            await client.agent.createModel(normalized as any);
                            showToast('Model created', 'success');
                        }
                        load();
                    } catch (e: any) {
                        showToast(e.message || 'Failed to save model', 'error');
                    }
                }}
                title={editing ? 'Edit Model' : 'New Model'}
                fields={fields}
                initialData={editing}
            />
        </Box>
    );
}
