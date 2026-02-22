import { useEffect, useState, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { OrchestratorClient } from '@orch/client';
import DashboardView from './views/DashboardView.js';
import ChatView from './views/ChatView.js';
import CanvasView from './views/CanvasView.js';
import {
    ThemeProvider,
    CssBaseline,
    Box,
    Drawer,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Typography,
    IconButton,
    useMediaQuery,
    CircularProgress,
    Alert,
    Button
} from '@mui/material';

import ConsoleView from './views/ConsoleView.js';
import { lightTheme, darkTheme } from './theme.js';
import {
    Terminal,
    LayoutDashboard,
    MessageSquare,
    Paintbrush,
    Moon,
    Sun,
    Menu,
    ChevronLeft
} from 'lucide-react';

const drawerWidth = 240;
const collapsedWidth = 64;

const Sidebar = ({ toggleTheme, mode, open, setOpen }: { toggleTheme: () => void, mode: 'light' | 'dark', open: boolean, setOpen: (o: boolean) => void }) => {
    const location = useLocation();

    const links = [
        { path: '/', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/chat', label: 'Agent Chat', icon: MessageSquare },
        { path: '/console', label: 'Console', icon: Terminal },
        { path: '/canvas', label: 'Dynamic Canvas', icon: Paintbrush }
    ];

    const width = open ? drawerWidth : collapsedWidth;

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
                    overflowX: 'hidden'
                 },
                transition: 'width 0.2s ease-in-out'
            }}
        >
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: open ? 'space-between' : 'center', flexDirection: open ? 'row' : 'column', gap: open ? 0 : 2 }}>
                {open && (
                    <Typography variant="h6" noWrap component="div" fontWeight="bold">
                        Orchestrator
                    </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1, flexDirection: open ? 'row' : 'column' }}>
                    <IconButton onClick={toggleTheme} color="inherit" size="small">
                        {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                    </IconButton>
                    <IconButton onClick={() => setOpen(!open)} color="inherit" size="small">
                        {open ? <ChevronLeft size={20} /> : <Menu size={20} />}
                    </IconButton>
                </Box>
            </Box>
            <List>
                {links.map((l) => (
                    <ListItem key={l.path} disablePadding sx={{ display: 'block' }}>
                        <ListItemButton
                            component={Link}
                            to={l.path}
                            selected={location.pathname === l.path}
                            sx={{ minHeight: 48, justifyContent: open ? 'initial' : 'center', px: 2.5 }}
                        >
                            <ListItemIcon sx={{ minWidth: 0, mr: open ? 3 : 'auto', justifyContent: 'center' }}>
                                <l.icon size={20} />
                            </ListItemIcon>
                            <ListItemText primary={l.label} sx={{ opacity: open ? 1 : 0, transition: 'opacity 0.2s' }} />
                        </ListItemButton>
                    </ListItem>
                ))}
            </List>
        </Drawer>
    );
};

export default function App() {
    const location = useLocation();
    const isCanvas = location.pathname === '/canvas';
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
    const [mode, setMode] = useState<'light' | 'dark'>(prefersDarkMode ? 'dark' : 'light');
    const [sidebarOpen, setSidebarOpen] = useState(!isCanvas);

    useEffect(() => {
        if (location.pathname === '/canvas') {
            setSidebarOpen(false);
        }
    }, [location.pathname]);

    const theme = useMemo(() => mode === 'light' ? lightTheme : darkTheme, [mode]);

    const toggleTheme = () => {
        setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
    };

    const [client, setClient] = useState<OrchestratorClient | null>(null);
    const [connecting, setConnecting] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const initClient = async () => {
            const orch = new OrchestratorClient({
                url: `ws://${window.location.host}/api/ws`,
                token: 'mock-ui-token',
                timeoutMs: 5000
            });
            try {
                await orch.connect();
                setClient(orch);
                setConnecting(false);
            } catch (err: any) {
                console.error(err);
                setError(err.message);
                setConnecting(false);
            }
        };
        initClient();
    }, []);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
                <Sidebar toggleTheme={toggleTheme} mode={mode} open={sidebarOpen} setOpen={setSidebarOpen} />
                <Box component="main" sx={{ flexGrow: 1, p: isCanvas ? 0 : 3, position: 'relative', overflow: 'auto' }}>
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
                        <Route path="/" element={<DashboardView client={client} />} />
                        <Route path="/chat" element={<ChatView client={client} />} />
                        <Route path="/console" element={<ConsoleView client={client} />} />
                        <Route path="/canvas" element={<CanvasView client={client} />} />
                    </Routes>
                </Box>
            </Box>
        </ThemeProvider>
    );
}
