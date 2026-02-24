/**
 * ProviderList — CRUD list for AI provider configurations.
 * Includes Ollama auto-detect and sync button.
 */

import { useState, useEffect, useContext } from 'react';
import {
    Box, Typography, IconButton, Button, Card, CardContent, Chip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Alert, CircularProgress, Collapse,
} from '@mui/material';
import { Plus, Pencil, Trash2, Server, RefreshCw, Check, X as XIcon } from 'lucide-react';
import { ClientContext } from '../../ClientContext.js';
import ConfigFormDialog, { type FieldDef } from './ConfigFormDialog.js';

const PROVIDER_FIELDS: FieldDef[] = [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'type', label: 'Provider Type', type: 'select', required: true, options: [
        { value: 'google', label: 'Google (Gemini)' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'ollama', label: 'Ollama' },
        { value: 'groq', label: 'Groq' },
        { value: 'custom', label: 'Custom' },
    ]},
    { name: 'baseUrl', label: 'Base URL (optional)', type: 'text' },
    { name: 'adapter', label: 'Adapter', type: 'select', options: [
        { value: 'adk-native', label: 'ADK Native' },
        { value: 'anthropic', label: 'Anthropic Adapter' },
        { value: 'ollama', label: 'Ollama Adapter' },
    ] },
    { name: 'authType', label: 'Auth Type', type: 'select', options: [
        { value: 'api-key', label: 'API Key' },
        { value: 'bearer', label: 'Bearer' },
        { value: 'none', label: 'None' },
    ] },
    { name: 'apiKeyRef', label: 'Vault API Key Reference', type: 'text' },
    { name: 'headers', label: 'Headers (JSON)', type: 'json', default: '{}' },
    { name: 'timeoutMs', label: 'Timeout (ms)', type: 'number' },
];

export default function ProviderList() {
    const client = useContext(ClientContext);
    const [providers, setProviders] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<any>(null);
    const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);

    const load = async () => {
        if (!client) return;
        try {
            const res = await client.agent.listProviders();
            setProviders(res.providers || []);
        } catch (e) { console.error('Failed to load providers:', e); }
    };

    // Check Ollama availability on mount
    const checkOllama = async () => {
        if (!client) return;
        try {
            const res = await client.agent.checkOllama();
            setOllamaAvailable(res.available);
        } catch { setOllamaAvailable(false); }
    };

    useEffect(() => { load(); checkOllama(); }, [client]);

    const handleCreate = async (data: Record<string, any>) => {
        if (!client) return;
        await client.agent.createProvider(data as any);
        load();
    };

    const handleUpdate = async (data: Record<string, any>) => {
        if (!client || !editing) return;
        await client.agent.updateProvider(editing.id, data);
        setEditing(null);
        load();
    };

    const handleDelete = async (id: string) => {
        if (!client) return;
        await client.agent.deleteProvider(id);
        load();
    };

    const handleSyncOllama = async () => {
        if (!client) return;
        setSyncing(true);
        setSyncResult(null);
        try {
            const result = await client.agent.syncOllama();
            setSyncResult(result);
            if (result.available) {
                load(); // Refresh provider list
            }
        } catch (e: any) {
            setSyncResult({ available: false, error: e.message });
        }
        setSyncing(false);
    };

    const typeColors: Record<string, string> = {
        google: '#4285F4', openai: '#10a37f', anthropic: '#d97706',
        ollama: '#6366f1', groq: '#ef4444', custom: '#6b7280',
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Server size={20} /> Providers
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        startIcon={syncing ? <CircularProgress size={14} /> : <RefreshCw size={16} />}
                        variant="outlined"
                        size="small"
                        onClick={handleSyncOllama}
                        disabled={syncing}
                        sx={{
                            borderColor: ollamaAvailable ? '#6366f1' : undefined,
                            color: ollamaAvailable ? '#6366f1' : undefined,
                        }}
                    >
                        {syncing ? 'Syncing...' : 'Sync Ollama'}
                        {ollamaAvailable !== null && (
                            <Chip
                                label={ollamaAvailable ? 'Online' : 'Offline'}
                                size="small"
                                sx={{
                                    ml: 1, height: 18, fontSize: '0.65rem',
                                    bgcolor: ollamaAvailable ? '#22c55e' : '#ef4444',
                                    color: '#fff',
                                }}
                            />
                        )}
                    </Button>
                    <Button startIcon={<Plus size={16} />} variant="contained" size="small"
                        onClick={() => { setEditing(null); setDialogOpen(true); }}>
                        Add Provider
                    </Button>
                </Box>
            </Box>

            {/* Sync result banner */}
            <Collapse in={!!syncResult}>
                {syncResult && (
                    <Alert
                        severity={syncResult.available ? 'success' : 'warning'}
                        onClose={() => setSyncResult(null)}
                        sx={{ mb: 2 }}
                    >
                        {!syncResult.available ? (
                            'Ollama is not running locally. Start it with `ollama serve` and try again.'
                        ) : (
                            <>
                                <strong>Synced {syncResult.totalLocalModels} models.</strong>
                                {syncResult.modelsAdded.length > 0 && (
                                    <> Added: {syncResult.modelsAdded.join(', ')}.</>
                                )}
                                {syncResult.modelsRemoved.length > 0 && (
                                    <> Removed: {syncResult.modelsRemoved.join(', ')}.</>
                                )}
                                {syncResult.providerCreated && <> Ollama provider auto-created.</>}
                                {syncResult.modelsAdded.length === 0 && syncResult.modelsRemoved.length === 0 && (
                                    <> All models up to date.</>
                                )}
                            </>
                        )}
                    </Alert>
                )}
            </Collapse>

            {providers.length === 0 ? (
                <Card variant="outlined"><CardContent>
                    <Typography color="text.secondary" textAlign="center">
                        No providers configured. Click "Sync Ollama" to auto-detect or "Add Provider" to configure manually.
                    </Typography>
                </CardContent></Card>
            ) : (
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Base URL</TableCell>
                                <TableCell>API Key Ref</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {providers.map(p => (
                                <TableRow key={p.id} hover>
                                    <TableCell><Typography fontWeight={500}>{p.name}</Typography></TableCell>
                                    <TableCell>
                                        <Chip label={p.type} size="small"
                                            sx={{ bgcolor: typeColors[p.type] || '#6b7280', color: '#fff', fontWeight: 600 }} />
                                    </TableCell>
                                    <TableCell><Typography variant="body2" color="text.secondary">{p.baseUrl || '—'}</Typography></TableCell>
                                    <TableCell><Typography variant="body2" fontFamily="monospace">{p.apiKeyRef || '—'}</Typography></TableCell>
                                    <TableCell align="right">
                                        <IconButton size="small" onClick={() => { setEditing(p); setDialogOpen(true); }}>
                                            <Pencil size={16} />
                                        </IconButton>
                                        <IconButton size="small" color="error" onClick={() => handleDelete(p.id)}>
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
                onSubmit={editing ? handleUpdate : handleCreate}
                title={editing ? 'Edit Provider' : 'New Provider'}
                fields={PROVIDER_FIELDS}
                initialData={editing}
            />
        </Box>
    );
}
