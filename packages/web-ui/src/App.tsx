import { useEffect, useState, useMemo } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { OrchestratorClient } from '@orch/client';
import { ClientContext } from './ClientContext.js';

import DashboardView from './views/DashboardView.js';
import ChatView from './views/ChatView.js';
import ConsoleView from './views/ConsoleView.js';
import TerminalView from './views/TerminalView.js';
import DataView from './views/DataView.js';
import CanvasView from './views/CanvasView.js';
import AuthView from './views/AuthView.js';
import LoginView from './views/LoginView.js';
import AIConfigView from './views/AIConfigView.js';
import WorkflowBuilderView from './views/WorkflowBuilderView.js';
import WorkflowRunsView from './views/WorkflowRunsView.js';
import MediaView from './views/MediaView.js';
import PluginsView from './views/PluginsView.js';
import { lightTheme, darkTheme } from './theme.js';
import {
    Box,
    Drawer,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Typography,
    IconButton,
    ThemeProvider,
    CssBaseline,
    CircularProgress,
    Alert,
    Button,
    useMediaQuery,
    Fab,
} from '@mui/material';
import {
    Terminal,
    SquareTerminal,
    LayoutDashboard,
    MessageSquare,
    Paintbrush,
    Moon,
    Sun,
    Menu,
    ChevronLeft,
    Users,
    Database,
    X,
    Sparkles,
    FolderOpen,
    Puzzle,
} from 'lucide-react';

import { ToastProvider } from './components/ToastContext.js';

const drawerWidth = 240;
const collapsedWidth = 64;

const Sidebar = ({
    toggleTheme,
    mode,
    open,
    setOpen,
    isMobile,
}: {
    toggleTheme: () => void;
    mode: 'light' | 'dark';
    open: boolean;
    setOpen: (o: boolean) => void;
    isMobile: boolean;
}) => {
    const location = useLocation();

    const links = [
        { path: '/', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/chat', label: 'Agent Chat', icon: MessageSquare },
        { path: '/ai-config', label: 'AI Config', icon: Sparkles },
        { path: '/workflow-builder', label: 'Workflow Builder', icon: Sparkles },
        { path: '/workflow-runs', label: 'Workflow Runs', icon: Sparkles },
        { path: '/console', label: 'Console', icon: Terminal },
        { path: '/terminal', label: 'Terminal', icon: SquareTerminal },
        { path: '/data', label: 'Data Explorer', icon: Database },
        { path: '/media', label: 'Media & Files', icon: FolderOpen },
        { path: '/plugins', label: 'Plugins', icon: Puzzle },
        { path: '/canvas', label: 'Dynamic Canvas', icon: Paintbrush },
        { path: '/auth', label: 'Access Control', icon: Users },
    ];

    const width = isMobile ? drawerWidth : open ? drawerWidth : collapsedWidth;

    const drawerContent = (
        <>
            <Box
                sx={{
                    p: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isMobile || open ? 'space-between' : 'center',
                    flexDirection: isMobile || open ? 'row' : 'column',
                    gap: isMobile || open ? 0 : 2,
                }}
            >
                {(isMobile || open) && (
                    <Typography variant="h6" noWrap component="div" fontWeight="bold">
                        Orchestrator
                    </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1, flexDirection: isMobile || open ? 'row' : 'column' }}>
                    <IconButton onClick={toggleTheme} color="inherit" size="small">
                        {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                    </IconButton>
                    {isMobile ? (
                        <IconButton onClick={() => setOpen(false)} color="inherit" size="small">
                            <X size={20} />
                        </IconButton>
                    ) : (
                        <IconButton onClick={() => setOpen(!open)} color="inherit" size="small">
                            {open ? <ChevronLeft size={20} /> : <Menu size={20} />}
                        </IconButton>
                    )}
                </Box>
            </Box>
            <List>
                {links.map((l) => (
                    <ListItem key={l.path} disablePadding sx={{ display: 'block' }}>
                        <ListItemButton
                            component={Link}
                            to={l.path}
                            selected={location.pathname === l.path}
                            onClick={() => { if (isMobile) setOpen(false); }}
                            sx={{ minHeight: 48, justifyContent: isMobile || open ? 'initial' : 'center', px: 2.5 }}
                        >
                            <ListItemIcon sx={{ minWidth: 0, mr: isMobile || open ? 3 : 'auto', justifyContent: 'center' }}>
                                <l.icon size={20} />
                            </ListItemIcon>
                            <ListItemText
                                primary={l.label}
                                sx={{ opacity: isMobile || open ? 1 : 0, transition: 'opacity 0.2s' }}
                            />
                        </ListItemButton>
                    </ListItem>
                ))}
            </List>
        </>
    );

    if (isMobile) {
        return (
            <Drawer
                variant="temporary"
                open={open}
                onClose={() => setOpen(false)}
                ModalProps={{ keepMounted: true }}
                sx={{
                    '& .MuiDrawer-paper': {
                        width: drawerWidth,
                        boxSizing: 'border-box',
                    },
                }}
            >
                {drawerContent}
            </Drawer>
        );
    }

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: width,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: {
                    width: width,
                    boxSizing: 'border-box',
                    transition: 'width 0.2s ease-in-out',
                    overflowX: 'hidden',
                },
                transition: 'width 0.2s ease-in-out',
            }}
        >
            {drawerContent}
        </Drawer>
    );
};

export default function App() {
    const location = useLocation();
    const isCanvas = location.pathname === '/canvas';
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
    const [mode, setMode] = useState<'light' | 'dark'>(prefersDarkMode ? 'dark' : 'light');
    const [sidebarOpen, setSidebarOpen] = useState(!isCanvas);
    const isMobile = useMediaQuery('(max-width: 768px)');

    useEffect(() => {
        if (location.pathname === '/canvas') {
            setSidebarOpen(false);
        }
    }, [location.pathname]);

    // On mobile, sidebar starts closed
    useEffect(() => {
        if (isMobile) {
            setSidebarOpen(false);
        }
    }, [isMobile]);

    const theme = useMemo(() => (mode === 'light' ? lightTheme : darkTheme), [mode]);

    const toggleTheme = () => {
        setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
    };

    const [client, setClient] = useState<OrchestratorClient | null>(null);
    const [connecting, setConnecting] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    useEffect(() => {
        let mounted = true;
        let orch: OrchestratorClient | null = null;

        const initClient = async () => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            orch = new OrchestratorClient({
                url: `${protocol}//${window.location.host}/api/ws`,
                timeoutMs: 10000,
            });
            try {
                await orch.connect();
                if (mounted) {
                    setClient(orch);
                    setConnecting(false);
                }
            } catch (err: any) {
                console.error(err);
                if (mounted) {
                    setError(err.message);
                    setConnecting(false);
                }
            }
        };
        initClient();

        return () => {
            mounted = false;
            if (orch !== null) {
                orch.disconnect().catch(console.error);
            }
        };
    }, []);

    if (!isAuthenticated && client) {
        return (
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <ToastProvider>
                    <ClientContext.Provider value={client}>
                        <LoginView onLoginSuccess={() => setIsAuthenticated(true)} />
                    </ClientContext.Provider>
                </ToastProvider>
            </ThemeProvider>
        );
    }

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <ToastProvider>
                <ClientContext.Provider value={client}>
                    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
                        <Sidebar
                            toggleTheme={toggleTheme}
                            mode={mode}
                            open={sidebarOpen}
                            setOpen={setSidebarOpen}
                            isMobile={isMobile}
                        />

                    {/* Mobile menu fab */}
                    {isMobile && !sidebarOpen && (
                        <Fab
                            size="small"
                            onClick={() => setSidebarOpen(true)}
                            sx={{
                                position: 'fixed',
                                top: 12,
                                left: 12,
                                zIndex: (t) => t.zIndex.drawer + 1,
                                bgcolor: 'background.paper',
                                color: 'text.primary',
                                boxShadow: 2,
                            }}
                        >
                            <Menu size={20} />
                        </Fab>
                    )}

                    <Box
                        component="main"
                        sx={{
                            flexGrow: 1,
                            p: isCanvas ? 0 : { xs: 1, sm: 2, md: 3 },
                            position: 'relative',
                            overflow: 'auto',
                            width: '100%',
                        }}
                    >
                        {connecting && (
                            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'background.default', opacity: 0.8, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <CircularProgress size={24} />
                                    <Typography>Connecting to Daemon API...</Typography>
                                </Box>
                            </Box>
                        )}
                        {error && (
                            <Alert
                                severity="error"
                                sx={{ mb: 3 }}
                                action={
                                    <Button color="inherit" size="small" onClick={() => window.location.reload()}>
                                        RETRY
                                    </Button>
                                }
                            >
                                Failed to boot Application Context: {error}
                            </Alert>
                        )}
                        <Routes>
                            <Route path="/" element={<DashboardView />} />
                            <Route path="/chat" element={<ChatView />} />
                            <Route path="/ai-config" element={<AIConfigView />} />
                            <Route path="/workflow-builder" element={<WorkflowBuilderView />} />
                            <Route path="/workflow-runs" element={<WorkflowRunsView />} />
                            <Route path="/console" element={<ConsoleView />} />
                            <Route path="/terminal" element={<TerminalView />} />
                            <Route path="/data" element={<DataView />} />
                            <Route path="/media" element={<MediaView />} />
                            <Route path="/plugins" element={<PluginsView />} />
                            <Route path="/canvas" element={<CanvasView />} />
                            <Route path="/canvas/:id" element={<CanvasView />} />
                            <Route path="/auth" element={<AuthView />} />
                        </Routes>
                    </Box>
                </Box>
                </ClientContext.Provider>
            </ToastProvider>
        </ThemeProvider>
    );
}
