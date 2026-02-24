/**
 * WorkflowList — CRUD list for AI workflow configurations.
 */

import { useState, useEffect, useContext } from 'react';
import {
    Box, Typography, IconButton, Button, Card, CardContent, Chip, Stack,
} from '@mui/material';
import { Plus, Pencil, Trash2, GitBranch, Play } from 'lucide-react';
import { ClientContext } from '../../ClientContext.js';
import ConfigFormDialog, { type FieldDef } from './ConfigFormDialog.js';

const WORKFLOW_FIELDS: FieldDef[] = [
    { name: 'name', label: 'Workflow Name', type: 'text', required: true },
    { name: 'description', label: 'Description', type: 'multiline' },
    { name: 'type', label: 'Execution Type', type: 'select', required: true, options: [
        { value: 'sequential', label: 'Sequential' },
        { value: 'parallel', label: 'Parallel' },
        { value: 'loop', label: 'Loop' },
    ]},
    { name: 'steps', label: 'Steps (JSON Array)', type: 'json', default: '[]' },
];

const typeColors: Record<string, string> = {
    sequential: '#3b82f6', parallel: '#8b5cf6', loop: '#f59e0b',
};

export default function WorkflowList() {
    const client = useContext(ClientContext);
    const [workflows, setWorkflows] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    const load = async () => {
        if (!client) return;
        try {
            const res = await client.agent.listWorkflowConfigs();
            setWorkflows(res.workflows || []);
        } catch (e) { console.error('Failed to load workflows:', e); }
    };

    useEffect(() => { load(); }, [client]);

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <GitBranch size={20} /> Workflows
                </Typography>
                <Button startIcon={<Plus size={16} />} variant="contained" size="small"
                    onClick={() => { setEditing(null); setDialogOpen(true); }}>
                    New Workflow
                </Button>
            </Box>

            {workflows.length === 0 ? (
                <Card variant="outlined"><CardContent>
                    <Typography color="text.secondary" textAlign="center">
                        No workflows configured. Workflows let you chain agents in sequential, parallel, or loop patterns.
                    </Typography>
                </CardContent></Card>
            ) : (
                <Stack spacing={1.5}>
                    {workflows.map(w => (
                        <Card key={w.id} variant="outlined" sx={{ '&:hover': { borderColor: 'primary.main' }, transition: 'border-color 0.2s' }}>
                            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Typography fontWeight={600}>{w.name}</Typography>
                                            <Chip label={w.type} size="small"
                                                sx={{ bgcolor: typeColors[w.type] || '#6b7280', color: '#fff', fontWeight: 600, fontSize: '0.7rem' }} />
                                            <Chip label={`${(w.steps || []).length} steps`} size="small" variant="outlined" />
                                        </Box>
                                        {w.description && (
                                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                                {w.description}
                                            </Typography>
                                        )}
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                        <IconButton size="small" color="primary" title="Run Workflow"
                                            onClick={async () => {
                                                if (!client) return;
                                                const input = prompt('Enter workflow input:');
                                                if (!input) return;
                                                try { for await (const ev of client.agent.runWorkflowExec(w.id, input)) { console.log('workflow event:', ev); } }
                                                catch (e) { console.error('Workflow error:', e); }
                                            }}>
                                            <Play size={16} />
                                        </IconButton>
                                        <IconButton size="small" onClick={() => { setEditing(w); setDialogOpen(true); }}>
                                            <Pencil size={16} />
                                        </IconButton>
                                        <IconButton size="small" color="error" onClick={() => client?.agent.deleteWorkflowConfig(w.id).then(load)}>
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
                    if (editing) await client.agent.updateWorkflowConfig(editing.id, data);
                    else await client.agent.createWorkflowConfig(data as any);
                    load();
                }}
                title={editing ? 'Edit Workflow' : 'New Workflow'}
                fields={WORKFLOW_FIELDS}
                initialData={editing}
            />
        </Box>
    );
}
