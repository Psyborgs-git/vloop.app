import { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Button,
    TextField,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Chip,
    IconButton,
    Tabs,
    Tab,
    Alert
} from '@mui/material';
import { Trash2, Plus, Key } from 'lucide-react';
import { useClient } from '../ClientContext.js';

export default function AuthView() {
    const client = useClient();
    const [tab, setTab] = useState(0);
    const [users, setUsers] = useState<any[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);

    // User Dialog State
    const [userDialogOpen, setUserDialogOpen] = useState(false);
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserRoles, setNewUserRoles] = useState('viewer');

    // Password Dialog State
    const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
    const [passwordUserEmail, setPasswordUserEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');

    // Provider Dialog State
    const [providerDialogOpen, setProviderDialogOpen] = useState(false);
    const [newProviderName, setNewProviderName] = useState('');
    const [newProviderIssuer, setNewProviderIssuer] = useState('');
    const [newProviderJwks, setNewProviderJwks] = useState('');

    useEffect(() => {
        if (client) {
            loadData();
        }
    }, [client, tab]);

    const loadData = async () => {
        try {
            setError(null);
            if (tab === 0) {
                const res = await client?.auth.listUsers();
                setUsers(res || []);
            } else {
                const res = await client?.auth.listProviders();
                setProviders(res || []);
            }
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleCreateUser = async () => {
        try {
            await client?.auth.createUser(
                newUserEmail,
                newUserPassword,
                newUserRoles.split(',').map(r => r.trim())
            );
            setUserDialogOpen(false);
            setNewUserEmail('');
            setNewUserPassword('');
            setNewUserRoles('viewer');
            loadData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleUpdatePassword = async () => {
        try {
            await client?.auth.updatePassword(passwordUserEmail, newPassword);
            setPasswordDialogOpen(false);
            setPasswordUserEmail('');
            setNewPassword('');
            loadData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleAddProvider = async () => {
        try {
            await client?.auth.addProvider(
                newProviderIssuer,
                newProviderJwks,
                newProviderName
            );
            setProviderDialogOpen(false);
            setNewProviderName('');
            setNewProviderIssuer('');
            setNewProviderJwks('');
            loadData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleRemoveProvider = async (id: string) => {
        try {
            await client?.auth.removeProvider(id);
            loadData();
        } catch (err: any) {
            setError(err.message);
        }
    };

    if (!client) return <Typography>Loading...</Typography>;

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h4" gutterBottom>Access Control</Typography>
            
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs value={tab} onChange={(_, v) => setTab(v)}>
                    <Tab label="Local Users" />
                    <Tab label="JWT Providers" />
                </Tabs>
            </Box>

            {tab === 0 && (
                <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6">Users</Typography>
                        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setUserDialogOpen(true)}>
                            Add User
                        </Button>
                    </Box>
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>ID</TableCell>
                                    <TableCell>Email</TableCell>
                                    <TableCell>Roles</TableCell>
                                    <TableCell>Created At</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {users.map((user) => (
                                    <TableRow key={user.id}>
                                        <TableCell>{user.id}</TableCell>
                                        <TableCell>{user.email}</TableCell>
                                        <TableCell>
                                            {user.allowedRoles?.map((r: string) => (
                                                <Chip key={r} label={r} size="small" sx={{ mr: 0.5 }} />
                                            ))}
                                        </TableCell>
                                        <TableCell>{new Date(user.createdAt).toLocaleString()}</TableCell>
                                        <TableCell align="right">
                                            <IconButton color="primary" onClick={() => {
                                                setPasswordUserEmail(user.email);
                                                setPasswordDialogOpen(true);
                                            }} title="Change Password">
                                                <Key size={18} />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {users.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center">No users found</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            )}

            {tab === 1 && (
                <Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6">Whitelisted JWT Providers</Typography>
                        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setProviderDialogOpen(true)}>
                            Add Provider
                        </Button>
                    </Box>
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Name</TableCell>
                                    <TableCell>Issuer</TableCell>
                                    <TableCell>JWKS URL</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {providers.map((provider) => (
                                    <TableRow key={provider.id}>
                                        <TableCell>{provider.name}</TableCell>
                                        <TableCell>{provider.issuer}</TableCell>
                                        <TableCell>{provider.jwks_url}</TableCell>
                                        <TableCell align="right">
                                            <IconButton color="error" onClick={() => handleRemoveProvider(provider.id)}>
                                                <Trash2 size={18} />
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {providers.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={4} align="center">No providers found</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            )}

            {/* Create User Dialog */}
            <Dialog open={userDialogOpen} onClose={() => setUserDialogOpen(false)}>
                <DialogTitle>Create Local User</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Email Address"
                        type="email"
                        fullWidth
                        variant="outlined"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        sx={{ mb: 2, mt: 1 }}
                    />
                    <TextField
                        margin="dense"
                        label="Password"
                        type="password"
                        fullWidth
                        variant="outlined"
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        sx={{ mb: 2 }}
                    />
                    <TextField
                        margin="dense"
                        label="Roles (comma separated)"
                        type="text"
                        fullWidth
                        variant="outlined"
                        value={newUserRoles}
                        onChange={(e) => setNewUserRoles(e.target.value)}
                        helperText="e.g. admin, viewer"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUserDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleCreateUser} variant="contained">Create</Button>
                </DialogActions>
            </Dialog>

            {/* Change Password Dialog */}
            <Dialog open={passwordDialogOpen} onClose={() => setPasswordDialogOpen(false)}>
                <DialogTitle>Change Password for {passwordUserEmail}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="New Password"
                        type="password"
                        fullWidth
                        variant="outlined"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        sx={{ mb: 2, mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setPasswordDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleUpdatePassword} variant="contained">Update</Button>
                </DialogActions>
            </Dialog>

            {/* Add Provider Dialog */}
            <Dialog open={providerDialogOpen} onClose={() => setProviderDialogOpen(false)}>
                <DialogTitle>Add JWT Provider</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Provider Name"
                        type="text"
                        fullWidth
                        variant="outlined"
                        value={newProviderName}
                        onChange={(e) => setNewProviderName(e.target.value)}
                        sx={{ mb: 2, mt: 1 }}
                        helperText="e.g. Auth0, Clerk, Custom"
                    />
                    <TextField
                        margin="dense"
                        label="Issuer (iss claim)"
                        type="text"
                        fullWidth
                        variant="outlined"
                        value={newProviderIssuer}
                        onChange={(e) => setNewProviderIssuer(e.target.value)}
                        sx={{ mb: 2 }}
                        helperText="e.g. https://dev-xxxx.us.auth0.com/"
                    />
                    <TextField
                        margin="dense"
                        label="JWKS URL"
                        type="url"
                        fullWidth
                        variant="outlined"
                        value={newProviderJwks}
                        onChange={(e) => setNewProviderJwks(e.target.value)}
                        helperText="e.g. https://dev-xxxx.us.auth0.com/.well-known/jwks.json"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setProviderDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleAddProvider} variant="contained">Add</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}