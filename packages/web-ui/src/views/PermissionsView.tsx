import { useEffect, useState, useCallback } from 'react';
import {
    Box,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Button,
    TextField,
    IconButton,
    Chip,
    Stack,
    Alert,
    CircularProgress,
    Card,
    CardHeader,
    CardContent
} from '@mui/material';
import { Check, X, Trash, ShieldAlert, Plus } from 'lucide-react';
import { useClient } from '../ClientContext.js';
import { useToast } from '../components/ToastContext.js';

interface PermissionRequest {
    id: string;
    command: string;
    status: 'pending' | 'approved' | 'denied';
    createdAt: string;
}

interface AllowedCommand {
    id: string;
    command: string;
    createdAt: string;
}

export default function PermissionsView() {
    const client = useClient();
    const { toast } = useToast();
    const [requests, setRequests] = useState<PermissionRequest[]>([]);
    const [allowed, setAllowed] = useState<AllowedCommand[]>([]);
    const [loading, setLoading] = useState(false);
    const [newCommand, setNewCommand] = useState('');

    const fetchData = useCallback(async () => {
        if (!client) return;
        setLoading(true);
        try {
            const reqRes = await client.request('permissions.list_requests');
            setRequests((reqRes as any).requests);

            const allowRes = await client.request('permissions.list_allowed');
            setAllowed((allowRes as any).commands);
        } catch (err: any) {
            toast.error(`Failed to load permissions: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }, [client, toast]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000); // Poll for new requests
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleApprove = async (requestId: string) => {
        if (!client) return;
        try {
            await client.request('permissions.approve', { requestId });
            toast.success('Request approved');
            fetchData();
        } catch (err: any) {
            toast.error(`Failed to approve: ${err.message}`);
        }
    };

    const handleDeny = async (requestId: string) => {
        if (!client) return;
        try {
            await client.request('permissions.deny', { requestId });
            toast.success('Request denied');
            fetchData();
        } catch (err: any) {
            toast.error(`Failed to deny: ${err.message}`);
        }
    };

    const handleAdd = async () => {
        if (!client || !newCommand.trim()) return;
        try {
            await client.request('permissions.add', { command: newCommand.trim() });
            toast.success('Command allowed');
            setNewCommand('');
            fetchData();
        } catch (err: any) {
            toast.error(`Failed to add command: ${err.message}`);
        }
    };

    const handleRemove = async (command: string) => {
        if (!client) return;
        if (!confirm(`Are you sure you want to remove permission for "${command}"?`)) return;
        try {
            await client.request('permissions.remove', { command });
            toast.success('Permission removed');
            fetchData();
        } catch (err: any) {
            toast.error(`Failed to remove permission: ${err.message}`);
        }
    };

    return (
        <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
            <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
                <ShieldAlert size={32} />
                <Typography variant="h4" component="h1">
                    Process Permissions
                </Typography>
            </Box>

            <Stack spacing={4}>
                {/* Pending Requests */}
                <Card>
                    <CardHeader
                        title="Pending Requests"
                        subheader="Commands requested by users or agents requiring approval."
                        action={loading && <CircularProgress size={20} />}
                    />
                    <CardContent>
                        {requests.length === 0 ? (
                            <Alert severity="info">No pending requests.</Alert>
                        ) : (
                            <TableContainer component={Paper} variant="outlined">
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Command</TableCell>
                                            <TableCell>Requested At</TableCell>
                                            <TableCell align="right">Actions</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {requests.map((req) => (
                                            <TableRow key={req.id}>
                                                <TableCell sx={{ fontFamily: 'monospace' }}>
                                                    {req.command}
                                                </TableCell>
                                                <TableCell>
                                                    {new Date(req.createdAt).toLocaleString()}
                                                </TableCell>
                                                <TableCell align="right">
                                                    <IconButton
                                                        color="success"
                                                        onClick={() => handleApprove(req.id)}
                                                        title="Approve"
                                                    >
                                                        <Check size={20} />
                                                    </IconButton>
                                                    <IconButton
                                                        color="error"
                                                        onClick={() => handleDeny(req.id)}
                                                        title="Deny"
                                                    >
                                                        <X size={20} />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </CardContent>
                </Card>

                {/* Allowed Commands */}
                <Card>
                    <CardHeader
                        title="Allowed Commands"
                        subheader="Commands explicitly permitted to run via process.spawn."
                        action={
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField
                                    size="small"
                                    placeholder="Add command (e.g. /usr/bin/python3)"
                                    value={newCommand}
                                    onChange={(e) => setNewCommand(e.target.value)}
                                    sx={{ width: 300 }}
                                />
                                <Button
                                    variant="contained"
                                    startIcon={<Plus size={16} />}
                                    onClick={handleAdd}
                                    disabled={!newCommand.trim()}
                                >
                                    Add
                                </Button>
                            </Box>
                        }
                    />
                    <CardContent>
                        {allowed.length === 0 ? (
                            <Alert severity="warning">
                                No commands allowed. All process spawns will require approval.
                            </Alert>
                        ) : (
                            <TableContainer component={Paper} variant="outlined">
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Command</TableCell>
                                            <TableCell>Added At</TableCell>
                                            <TableCell align="right">Actions</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {allowed.map((cmd) => (
                                            <TableRow key={cmd.id}>
                                                <TableCell sx={{ fontFamily: 'monospace' }}>
                                                    {cmd.command}
                                                </TableCell>
                                                <TableCell>
                                                    {new Date(cmd.createdAt).toLocaleString()}
                                                </TableCell>
                                                <TableCell align="right">
                                                    <IconButton
                                                        color="error"
                                                        onClick={() => handleRemove(cmd.command)}
                                                        title="Remove"
                                                    >
                                                        <Trash size={20} />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </CardContent>
                </Card>
            </Stack>
        </Box>
    );
}
