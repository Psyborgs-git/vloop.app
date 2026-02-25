import { useState, useEffect } from 'react';
import { useClient } from '../../ClientContext.js';
import { useToast } from '../ToastContext.js';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Chip,
} from '@mui/material';
import { Delete as DeleteIcon, Edit as EditIcon, Add as AddIcon } from '@mui/icons-material';

export default function McpServerList() {
    const client = useClient();
    const { showToast } = useToast();
    const [servers, setServers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [openDialog, setOpenDialog] = useState(false);
    const [editingServer, setEditingServer] = useState<any | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        transport: 'stdio',
        url: '',
        command: '',
        args: '',
        env: '',
    });

    const fetchServers = async () => {
        if (!client) return;
        try {
            setLoading(true);
            const res = await client.agent.listMcpServers();
            setServers(res.mcpServers || []);
        } catch (err: any) {
            showToast(err.message || 'Failed to fetch MCP servers', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchServers();
    }, []);

    const handleOpenDialog = (server?: any) => {
        if (server) {
            setEditingServer(server);
            setFormData({
                name: server.name,
                transport: server.transport,
                url: server.url || '',
                command: server.command || '',
                args: server.args ? server.args.join(' ') : '',
                env: server.env ? JSON.stringify(server.env) : '',
            });
        } else {
            setEditingServer(null);
            setFormData({
                name: '',
                transport: 'stdio',
                url: '',
                command: '',
                args: '',
                env: '',
            });
        }
        setOpenDialog(true);
    };

    const handleCloseDialog = () => {
        setOpenDialog(false);
        setEditingServer(null);
    };

    const handleSave = async () => {
        try {
            const payload: any = {
                name: formData.name,
                transport: formData.transport,
            };

            if (formData.transport === 'sse') {
                payload.url = formData.url;
            } else {
                payload.command = formData.command;
                if (formData.args) {
                    payload.args = formData.args.split(' ').filter(Boolean);
                }
                if (formData.env) {
                    try {
                        payload.env = JSON.parse(formData.env);
                    } catch {
                        throw new Error('Invalid JSON in Environment Variables');
                    }
                }
            }

            if (!client) return;
            if (editingServer) {
                await client.agent.updateMcpServer(editingServer.id, payload);
                showToast('MCP server updated successfully', 'success');
            } else {
                await client.agent.createMcpServer(payload);
                showToast('MCP server created successfully', 'success');
            }
            handleCloseDialog();
            fetchServers();
        } catch (err: any) {
            showToast(err.message || 'Failed to save MCP server', 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (!client) return;
        if (!window.confirm('Are you sure you want to delete this MCP server?')) return;
        try {
            await client.agent.deleteMcpServer(id);
            showToast('MCP server deleted successfully', 'success');
            fetchServers();
        } catch (err: any) {
            showToast(err.message || 'Failed to delete MCP server', 'error');
        }
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6">MCP Servers</Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()}>
                    Add Server
                </Button>
            </Box>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Transport</TableCell>
                            <TableCell>Details</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {servers.map((server) => (
                            <TableRow key={server.id}>
                                <TableCell>{server.name}</TableCell>
                                <TableCell>
                                    <Chip label={server.transport} color={server.transport === 'sse' ? 'primary' : 'secondary'} size="small" />
                                </TableCell>
                                <TableCell>
                                    {server.transport === 'sse' ? (
                                        <Typography variant="body2">{server.url}</Typography>
                                    ) : (
                                        <Typography variant="body2">
                                            {server.command} {server.args?.join(' ')}
                                        </Typography>
                                    )}
                                </TableCell>
                                <TableCell align="right">
                                    <IconButton onClick={() => handleOpenDialog(server)} size="small">
                                        <EditIcon />
                                    </IconButton>
                                    <IconButton onClick={() => handleDelete(server.id)} size="small" color="error">
                                        <DeleteIcon />
                                    </IconButton>
                                </TableCell>
                            </TableRow>
                        ))}
                        {servers.length === 0 && !loading && (
                            <TableRow>
                                <TableCell colSpan={4} align="center">
                                    No MCP servers configured.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                <DialogTitle>{editingServer ? 'Edit MCP Server' : 'Add MCP Server'}</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
                        <TextField
                            label="Name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            fullWidth
                            required
                        />
                        <FormControl fullWidth>
                            <InputLabel>Transport</InputLabel>
                            <Select
                                value={formData.transport}
                                label="Transport"
                                onChange={(e) => setFormData({ ...formData, transport: e.target.value })}
                            >
                                <MenuItem value="stdio">Stdio</MenuItem>
                                <MenuItem value="sse">SSE</MenuItem>
                            </Select>
                        </FormControl>

                        {formData.transport === 'sse' ? (
                            <TextField
                                label="URL"
                                value={formData.url}
                                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                                fullWidth
                                required
                                placeholder="http://localhost:3001/mcp/sse"
                            />
                        ) : (
                            <>
                                <TextField
                                    label="Command"
                                    value={formData.command}
                                    onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                                    fullWidth
                                    required
                                    placeholder="npx"
                                />
                                <TextField
                                    label="Arguments (space separated)"
                                    value={formData.args}
                                    onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                                    fullWidth
                                    placeholder="-y @modelcontextprotocol/server-everything"
                                />
                                <TextField
                                    label="Environment Variables (JSON)"
                                    value={formData.env}
                                    onChange={(e) => setFormData({ ...formData, env: e.target.value })}
                                    fullWidth
                                    multiline
                                    rows={3}
                                    placeholder='{"API_KEY": "secret"}'
                                />
                            </>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>Cancel</Button>
                    <Button onClick={handleSave} variant="contained" disabled={!formData.name || (formData.transport === 'sse' ? !formData.url : !formData.command)}>
                        Save
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
