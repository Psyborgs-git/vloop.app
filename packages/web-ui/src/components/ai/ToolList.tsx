/**
 * ToolList — CRUD list for AI tool configurations.
 */

import { useState, useEffect, useContext } from 'react';
import {
    Box, Typography, IconButton, Button, Card, CardContent, Chip,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import { Plus, Pencil, Trash2, Wrench } from 'lucide-react';
import { ClientContext } from '../../ClientContext.js';
import { useToast } from '../ToastContext.js';
import ConfigFormDialog, { type FieldDef } from './ConfigFormDialog.js';

const TOOL_FIELDS: FieldDef[] = [
    { name: 'name', label: 'Tool Name', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'multiline', required: true },
    { name: 'handlerType', label: 'Handler Type', type: 'select', required: true, options: [
        { value: 'builtin', label: 'Built-in' },
        { value: 'script', label: 'Script' },
        { value: 'api', label: 'API Endpoint' },
    ]},
    { name: 'parametersSchema', label: 'Parameters Schema (JSON)', type: 'json', default: '{}' },
    { name: 'handlerConfig', label: 'Handler Config (JSON)', type: 'json', default: '{}' },
];

const handlerColors: Record<string, string> = {
    builtin: '#10b981', script: '#8b5cf6', api: '#f59e0b',
};

export default function ToolList() {
    const client = useContext(ClientContext);
    const { showToast } = useToast();
    const [tools, setTools] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    const load = async () => {
        if (!client) return;
        try {
            const res = await client.agent.listTools();
            setTools(res.tools || []);
        } catch (e: any) {
            showToast(`Failed to load tools: ${e.message}`, 'error');
        }
    };

    useEffect(() => { load(); }, [client]);

    const handleCreate = async (data: Record<string, any>) => {
        if (!client) return;
        try {
            await client.agent.createTool(data as any);
            showToast('Tool created successfully', 'success');
            load();
        } catch (e: any) {
            showToast(`Failed to create tool: ${e.message}`, 'error');
        }
    };

    const handleUpdate = async (data: Record<string, any>) => {
        if (!client || !editing) return;
        try {
            await client.agent.updateTool(editing.id, data);
            showToast('Tool updated successfully', 'success');
            setEditing(null);
            load();
        } catch (e: any) {
            showToast(`Failed to update tool: ${e.message}`, 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (!client) return;
        try {
            await client.agent.deleteTool(id);
            showToast('Tool deleted successfully', 'success');
            load();
        } catch (e: any) {
            showToast(`Failed to delete tool: ${e.message}`, 'error');
        }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Wrench size={20} /> Tools
                </Typography>
                <Button startIcon={<Plus size={16} />} variant="contained" size="small"
                    onClick={() => { setEditing(null); setDialogOpen(true); }}>
                    Add Tool
                </Button>
            </Box>

            {tools.length === 0 ? (
                <Card variant="outlined"><CardContent>
                    <Typography color="text.secondary" textAlign="center">
                        No custom tools configured. Built-in tools are always available.
                    </Typography>
                </CardContent></Card>
            ) : (
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Description</TableCell>
                                <TableCell>Source</TableCell>
                                <TableCell>Handler</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {tools.map(t => (
                                <TableRow key={t.id} hover>
                                    <TableCell><Typography fontWeight={500} fontFamily="monospace">{t.name}</Typography></TableCell>
                                    <TableCell><Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>{t.description}</Typography></TableCell>
                                    <TableCell>
                                        <Chip label={t.source || 'config'} size="small"
                                            sx={{ bgcolor: t.source === 'builtin' ? '#8b5cf6' : '#3b82f6', color: '#fff', fontWeight: 600 }} />
                                    </TableCell>
                                    <TableCell>
                                        <Chip label={t.handlerType} size="small"
                                            sx={{ bgcolor: handlerColors[t.handlerType] || '#6b7280', color: '#fff', fontWeight: 600 }} />
                                    </TableCell>
                                    <TableCell align="right">
                                        {t.source !== 'builtin' && (
                                            <>
                                                <IconButton size="small" onClick={() => { setEditing(t); setDialogOpen(true); }}>
                                                    <Pencil size={16} />
                                                </IconButton>
                                                <IconButton size="small" color="error" onClick={() => handleDelete(t.id)}>
                                                    <Trash2 size={16} />
                                                </IconButton>
                                            </>
                                        )}
                                        {t.source === 'builtin' && (
                                            <Typography variant="caption" color="text.secondary">System</Typography>
                                        )}
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
                title={editing ? 'Edit Tool' : 'New Tool'}
                fields={TOOL_FIELDS}
                initialData={editing}
            />
        </Box>
    );
}
