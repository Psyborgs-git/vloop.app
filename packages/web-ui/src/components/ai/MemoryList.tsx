/**
 * MemoryList — Viewer + search for cross-session memory entries.
 */

import { useState, useEffect, useContext } from 'react';
import {
    Box, Typography, IconButton, Button, Card, CardContent, TextField, Stack, Chip,
    InputAdornment,
} from '@mui/material';
import { Plus, Trash2, Brain, Search } from 'lucide-react';
import { ClientContext } from '../../ClientContext.js';
import ConfigFormDialog, { type FieldDef } from './ConfigFormDialog.js';

const MEMORY_FIELDS: FieldDef[] = [
    { name: 'content', label: 'Memory Content', type: 'multiline', required: true },
    { name: 'agentId', label: 'Agent ID (optional)', type: 'text' },
    { name: 'metadata', label: 'Metadata (JSON)', type: 'json', default: '{}' },
];

export default function MemoryList() {
    const client = useContext(ClientContext);
    const [memories, setMemories] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const load = async () => {
        if (!client) return;
        try {
            const res = searchQuery
                ? await client.agent.searchMemories(searchQuery)
                : await client.agent.listMemories();
            setMemories(res.memories || []);
        } catch (e) { console.error('Failed to load memories:', e); }
    };

    useEffect(() => { load(); }, [client]);

    const handleSearch = () => load();

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Brain size={20} /> Memory
                </Typography>
                <Button startIcon={<Plus size={16} />} variant="contained" size="small"
                    onClick={() => setDialogOpen(true)}>
                    Add Memory
                </Button>
            </Box>

            <TextField
                placeholder="Search memories..."
                size="small"
                fullWidth
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                sx={{ mb: 2 }}
                InputProps={{
                    startAdornment: (
                        <InputAdornment position="start"><Search size={16} /></InputAdornment>
                    ),
                    endAdornment: searchQuery ? (
                        <InputAdornment position="end">
                            <Button size="small" onClick={() => { setSearchQuery(''); load(); }}>Clear</Button>
                        </InputAdornment>
                    ) : null,
                }}
            />

            {memories.length === 0 ? (
                <Card variant="outlined"><CardContent>
                    <Typography color="text.secondary" textAlign="center">
                        {searchQuery ? 'No memories match your search.' : 'No memories stored yet. Memories persist across chat sessions.'}
                    </Typography>
                </CardContent></Card>
            ) : (
                <Stack spacing={1}>
                    {memories.map(m => (
                        <Card key={m.id} variant="outlined">
                            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <Box sx={{ flex: 1 }}>
                                        <Typography variant="body2">{m.content}</Typography>
                                        <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
                                            {m.agentId && <Chip label={`Agent: ${m.agentId.slice(0, 8)}...`} size="small" variant="outlined" />}
                                            <Chip label={new Date(m.createdAt).toLocaleDateString()} size="small" variant="outlined" />
                                        </Box>
                                    </Box>
                                    <IconButton size="small" color="error" onClick={() => client?.agent.deleteMemory(m.id).then(load)}>
                                        <Trash2 size={16} />
                                    </IconButton>
                                </Box>
                            </CardContent>
                        </Card>
                    ))}
                </Stack>
            )}

            <ConfigFormDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onSubmit={async (data) => {
                    if (!client) return;
                    await client.agent.addMemory(data as any);
                    load();
                }}
                title="Add Memory"
                fields={MEMORY_FIELDS}
            />
        </Box>
    );
}
