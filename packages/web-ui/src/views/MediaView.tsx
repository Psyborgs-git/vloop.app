import { useState, useEffect, useContext } from 'react';
import { Box, Typography, Paper, List, ListItem, ListItemIcon, ListItemText, IconButton, Breadcrumbs, Link, CircularProgress, Alert, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import { Folder, File, ChevronRight, HardDrive, Cloud, Download, Eye } from 'lucide-react';
import { ClientContext } from '../ClientContext.js';
import { useToast } from '../components/ToastContext.js';

interface MediaFile {
    id: string;
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    mimeType?: string;
    source: 'local' | 'google-drive' | 'onedrive';
    updatedAt: string;
}

export default function MediaView() {
    const client = useContext(ClientContext);
    const { showToast } = useToast();

    const [files, setFiles] = useState<MediaFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const [currentPath, setCurrentPath] = useState<string>('');
    const [source, setSource] = useState<'local' | 'google-drive' | 'onedrive'>('local');
    const [accessToken, setAccessToken] = useState<string>('');
    
    const [configOpen, setConfigOpen] = useState(false);

    const loadFiles = async (path: string = '') => {
        if (!client) return;
        setLoading(true);
        setError(null);
        try {
            const res = await client.request('media', 'list', {
                source,
                path: source === 'local' ? path : (path || 'root'),
                accessToken
            });
            setFiles(res as MediaFile[]);
            setCurrentPath(path);
        } catch (err: any) {
            setError(err.message);
            showToast(`Failed to load files: ${err.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (source === 'local' || accessToken) {
            loadFiles('');
        }
    }, [client, source, accessToken]);

    const handleNavigate = (file: MediaFile) => {
        if (file.type === 'directory') {
            loadFiles(file.path);
        }
    };

    const handleBreadcrumbClick = (index: number) => {
        if (source !== 'local') return; // Simplified breadcrumbs for cloud for now
        const parts = currentPath.split('/').filter(Boolean);
        const newPath = parts.slice(0, index + 1).join('/');
        loadFiles(newPath);
    };

    const formatSize = (bytes?: number) => {
        if (bytes === undefined) return '--';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h5" fontWeight="bold">Media & Files</Typography>
                <Button variant="outlined" onClick={() => setConfigOpen(true)}>
                    Configure Sources
                </Button>
            </Box>

            <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                {source === 'local' ? <HardDrive size={20} /> : <Cloud size={20} />}
                <Breadcrumbs separator={<ChevronRight size={16} />}>
                    <Link component="button" variant="body1" onClick={() => loadFiles('')} underline="hover" color="inherit">
                        {source === 'local' ? 'Local Root' : source === 'google-drive' ? 'Google Drive' : 'OneDrive'}
                    </Link>
                    {source === 'local' && currentPath.split('/').filter(Boolean).map((part, idx) => (
                        <Link key={idx} component="button" variant="body1" onClick={() => handleBreadcrumbClick(idx)} underline="hover" color="inherit">
                            {part}
                        </Link>
                    ))}
                </Breadcrumbs>
            </Paper>

            <Paper sx={{ flexGrow: 1, overflow: 'auto' }}>
                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                ) : error ? (
                    <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
                ) : files.length === 0 ? (
                    <Box sx={{ textAlign: 'center', p: 4, color: 'text.secondary' }}>
                        <Typography>No files found in this directory.</Typography>
                    </Box>
                ) : (
                    <List>
                        {files.map(file => (
                            <ListItem 
                                key={file.id}
                                sx={{ 
                                    borderBottom: '1px solid', 
                                    borderColor: 'divider',
                                    '&:hover': { bgcolor: 'action.hover' },
                                    cursor: file.type === 'directory' ? 'pointer' : 'default'
                                }}
                                onClick={() => handleNavigate(file)}
                            >
                                <ListItemIcon>
                                    {file.type === 'directory' ? <Folder color="#fbc02d" /> : <File color="#90caf9" />}
                                </ListItemIcon>
                                <ListItemText 
                                    primary={file.name} 
                                    secondary={new Date(file.updatedAt).toLocaleString()} 
                                />
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <Typography variant="body2" color="text.secondary" sx={{ width: 80, textAlign: 'right' }}>
                                        {formatSize(file.size)}
                                    </Typography>
                                    {file.type === 'file' && (
                                        <>
                                            <IconButton size="small"><Eye size={18} /></IconButton>
                                            <IconButton size="small"><Download size={18} /></IconButton>
                                        </>
                                    )}
                                </Box>
                            </ListItem>
                        ))}
                    </List>
                )}
            </Paper>

            <Dialog open={configOpen} onClose={() => setConfigOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Configure Media Source</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 2 }}>
                    <FormControl fullWidth>
                        <InputLabel>Source</InputLabel>
                        <Select value={source} label="Source" onChange={(e) => setSource(e.target.value as any)}>
                            <MenuItem value="local">Local File System</MenuItem>
                            <MenuItem value="google-drive">Google Drive</MenuItem>
                            <MenuItem value="onedrive">OneDrive</MenuItem>
                        </Select>
                    </FormControl>
                    
                    {source !== 'local' && (
                        <TextField 
                            label="Access Token" 
                            fullWidth 
                            value={accessToken} 
                            onChange={(e) => setAccessToken(e.target.value)}
                            helperText="Provide a valid OAuth access token for the selected cloud provider."
                        />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfigOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
