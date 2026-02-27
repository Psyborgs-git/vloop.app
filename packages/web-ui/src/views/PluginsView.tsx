import React, { useCallback, useEffect, useState, useContext } from 'react';
import {
    Box,
    Typography,
    Card,
    CardContent,
    Button,
    TextField,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    List,
    ListItem,
    ListItemText,
    CircularProgress,
    IconButton,
    Chip,
    Grid,
    Alert
} from '@mui/material';
import { Plus, Trash2 } from 'lucide-react';
import { ClientContext } from '../ClientContext.js';
import { useToast } from '../components/ToastContext.js';

interface Plugin {
    id: string;
    enabled: boolean;
    manifest: {
        id: string;
        name: string;
        version: string;
        description?: string;
        author?: string;
        permissions?: string[];
    };
    granted_permissions: string[];
    installed_at: string;
}

export default function PluginsView() {
    const client = useContext(ClientContext);
    const { showToast } = useToast();
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [installDialogOpen, setInstallDialogOpen] = useState(false);
    const [installUrl, setInstallUrl] = useState('');
    const [installing, setInstalling] = useState(false);
    const [pendingManifest, setPendingManifest] = useState<any>(null);
    const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(null);

    const refreshPlugins = useCallback(async () => {
        if (!client) return;
        try {
            const res = await client.request('plugin', 'list');
            setPlugins(res.items);
        } catch (err: any) {
            showToast('Failed to list plugins: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [client, showToast]);

    useEffect(() => {
        refreshPlugins();
    }, [refreshPlugins]);

    const handleCloseInstallDialog = async () => {
        if (pendingManifest && client) {
            try {
                await client.request('plugin', 'cancel', { id: pendingManifest.id });
            } catch {
                // best-effort cleanup
            }
        }
        setInstallDialogOpen(false);
        setPendingManifest(null);
        setInstallUrl('');
    };

    const handleAnalyze = async () => {
        if (!client || !installUrl) return;
        setInstalling(true);
        try {
            const manifest = await client.request('plugin', 'install', { url: installUrl });
            setPendingManifest(manifest);
        } catch (err: any) {
            showToast('Failed to fetch plugin: ' + err.message, 'error');
        } finally {
            setInstalling(false);
        }
    };

    const handleConfirmInstall = async () => {
        if (!client || !pendingManifest) return;
        setInstalling(true);
        try {
            await client.request('plugin', 'grant', {
                id: pendingManifest.id,
                permissions: pendingManifest.permissions || []
            });
            showToast(`Plugin ${pendingManifest.name} installed successfully`, 'success');
            setInstallDialogOpen(false);
            setPendingManifest(null);
            setInstallUrl('');
            refreshPlugins();
        } catch (err: any) {
            showToast('Installation failed: ' + err.message, 'error');
        } finally {
            setInstalling(false);
        }
    };

    const handleUninstall = async (id: string) => {
        if (!client) return;
        try {
            await client.request('plugin', 'uninstall', { id });
            showToast('Plugin uninstalled', 'info');
            setConfirmUninstallId(null);
            refreshPlugins();
        } catch (err: any) {
            showToast('Uninstall failed: ' + err.message, 'error');
        }
    };

    return (
        <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
                <Typography variant="h4" fontWeight="bold">Plugin Manager</Typography>
                <Button
                    variant="contained"
                    startIcon={<Plus />}
                    onClick={() => setInstallDialogOpen(true)}
                >
                    Install Plugin
                </Button>
            </Box>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
                    <CircularProgress />
                </Box>
            ) : plugins.length === 0 ? (
                <Alert severity="info">No plugins installed. Click "Install Plugin" to add one.</Alert>
            ) : (
                <Grid container spacing={3}>
                    {plugins.map((plugin) => (
                        <Grid item xs={12} md={6} lg={4} key={plugin.id}>
                            <Card variant="outlined">
                                <CardContent>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 1 }}>
                                        <Typography variant="h6">{plugin.manifest.name}</Typography>
                                        <Chip
                                            label={plugin.enabled ? 'Enabled' : 'Disabled'}
                                            color={plugin.enabled ? 'success' : 'default'}
                                            size="small"
                                        />
                                    </Box>
                                    <Typography variant="body2" color="text.secondary" gutterBottom>
                                        v{plugin.manifest.version} • {plugin.manifest.author || 'Unknown Author'}
                                    </Typography>
                                    <Typography variant="body2" sx={{ mb: 2, height: 40, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {plugin.manifest.description}
                                    </Typography>

                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="caption" fontWeight="bold" display="block" sx={{ mb: 0.5 }}>
                                            Permissions
                                        </Typography>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                            {plugin.granted_permissions.length > 0 ? (
                                                plugin.granted_permissions.map(p => (
                                                    <Chip key={p} label={p} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                                                ))
                                            ) : (
                                                <Typography variant="caption" color="text.secondary">None</Typography>
                                            )}
                                        </Box>
                                    </Box>

                                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                                        <IconButton size="small" color="error" onClick={() => setConfirmUninstallId(plugin.id)}>
                                            <Trash2 size={18} />
                                        </IconButton>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}

            {/* Install Dialog */}
            <Dialog open={installDialogOpen} onClose={handleCloseInstallDialog} maxWidth="sm" fullWidth>
                <DialogTitle>Install New Plugin</DialogTitle>
                <DialogContent>
                    {!pendingManifest ? (
                        <>
                            <Typography variant="body2" sx={{ mb: 2 }}>
                                Enter the URL of a plugin ZIP file or a local file path (for dev).
                            </Typography>
                            <TextField
                                autoFocus
                                margin="dense"
                                label="Plugin URL / Path"
                                type="url"
                                fullWidth
                                variant="outlined"
                                value={installUrl}
                                onChange={(e) => setInstallUrl(e.target.value)}
                            />
                        </>
                    ) : (
                        <Box>
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                This plugin requests the following permissions. Review carefully before granting access.
                            </Alert>
                            <Typography variant="h6">{pendingManifest.name} <Typography component="span" variant="body2" color="text.secondary">v{pendingManifest.version}</Typography></Typography>
                            <Typography variant="body2" paragraph>{pendingManifest.description}</Typography>

                            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Requested Permissions:</Typography>
                            <List dense sx={{ bgcolor: 'action.hover', borderRadius: 1 }}>
                                {(pendingManifest.permissions || []).map((p: string) => (
                                    <ListItem key={p}>
                                        <ListItemText primary={p} />
                                    </ListItem>
                                ))}
                                {(!pendingManifest.permissions || pendingManifest.permissions.length === 0) && (
                                    <ListItem>
                                        <ListItemText primary="No special permissions requested" sx={{ color: 'text.secondary', fontStyle: 'italic' }} />
                                    </ListItem>
                                )}
                            </List>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseInstallDialog}>Cancel</Button>
                    {!pendingManifest ? (
                        <Button onClick={handleAnalyze} disabled={!installUrl || installing}>
                            {installing ? <CircularProgress size={24} /> : 'Next'}
                        </Button>
                    ) : (
                        <Button onClick={handleConfirmInstall} disabled={installing} variant="contained" color="primary">
                            {installing ? <CircularProgress size={24} /> : 'Install & Grant'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            {/* Confirm Uninstall Dialog */}
            <Dialog open={!!confirmUninstallId} onClose={() => setConfirmUninstallId(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Uninstall Plugin</DialogTitle>
                <DialogContent>
                    <Typography>Are you sure you want to uninstall this plugin?</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmUninstallId(null)}>Cancel</Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => confirmUninstallId && handleUninstall(confirmUninstallId)}
                    >
                        Uninstall
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
