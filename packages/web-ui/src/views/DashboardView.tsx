import { useEffect, useState, useCallback, useRef } from 'react';
import {
    Activity,
    Box as BoxIcon,
    Server,
    Clock,
    Shield,
    RefreshCcw,
    Circle,
    User,
    Settings,
    Cpu,
    Play,
    Square
} from 'lucide-react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Paper,
    Chip,
    IconButton,
    Tooltip,
    LinearProgress,
    Skeleton,
    Tabs,
    Tab
} from '@mui/material';
import { useClient } from '../ClientContext.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardStats {
    services: Array<any>;
    processCount: number;
    containerCount: number;
    containers: Array<{ id: string; name: string; state: string; image: string }>;
    health: { status: string; timestamp: string } | null;
    session: { identity: string; roles: string[]; session_id: string } | null;
    uptime: string;
}

const INITIAL_STATS: DashboardStats = {
    services: [],
    processCount: 0,
    containerCount: 0,
    containers: [],
    health: null,
    session: null,
    uptime: '—',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function DashboardView() {
    const client = useClient();
    const [stats, setStats] = useState<DashboardStats>(INITIAL_STATS);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<string>('');
    const startTimeRef = useRef(Date.now());
    const [tabIndex, setTabIndex] = useState(0);

    const fetchStats = useCallback(async () => {
        if (!client) return;

        try {
            const [servicesRes, containerRes, healthRes, sessionRes] = await Promise.allSettled([
                client.request('services', 'list').catch(() => ({ services: [] })),
                client.request('container', 'container.list', { all: false }).catch(() => ({ containers: [] })),
                client.request('health', 'check').catch(() => null),
                client.request('session', 'info').catch(() => null),
            ]);

            const services = servicesRes.status === 'fulfilled' && (servicesRes.value as any)?.services
                ? (servicesRes.value as any).services
                : [];

            const processCount = services.filter((s: any) => s.type === 'process' || s.type === 'plugin').length;

            const containers = containerRes.status === 'fulfilled' && Array.isArray(containerRes.value)
                ? containerRes.value
                : containerRes.status === 'fulfilled' && (containerRes.value as any)?.containers
                    ? (containerRes.value as any).containers
                    : [];

            const health = healthRes.status === 'fulfilled' ? healthRes.value as any : null;
            const session = sessionRes.status === 'fulfilled' ? sessionRes.value as any : null;

            const uptimeMs = Date.now() - startTimeRef.current;
            const uptimeSec = Math.floor(uptimeMs / 1000);
            const h = Math.floor(uptimeSec / 3600);
            const m = Math.floor((uptimeSec % 3600) / 60);
            const s = uptimeSec % 60;
            const uptime = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;

            setStats({
                services,
                processCount,
                containerCount: containers.length,
                containers,
                health,
                session,
                uptime,
            });
            setLastRefresh(new Date().toLocaleTimeString());
        } catch (err) {
            console.error('Dashboard fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        if (!client) return;
        fetchStats();
        const interval = setInterval(fetchStats, 5000);
        return () => clearInterval(interval);
    }, [client, fetchStats]);

    const handleServiceAction = async (action: string, id: string) => {
        if (!client) return;
        try {
            await client.request('services', action, { id, force: true });
            fetchStats();
        } catch (err) {
            console.error(`Failed to ${action} service ${id}:`, err);
        }
    };

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabIndex(newValue);
    };

    // ── Stat Cards ──────────────────────────────────────────────────────

    const runningServices = stats.services.filter(s => s.status === 'running').length;

    const cards = [
        {
            label: 'Total Services',
            value: loading ? '...' : stats.services.length,
            icon: Activity,
            color: '#3b82f6',
            sub: `${runningServices} active runtimes`,
        },
        {
            label: 'Containers',
            value: loading ? '...' : stats.containerCount,
            icon: BoxIcon,
            color: '#a855f7',
            sub: stats.containers.filter(c => c.state === 'running' || (c as any).State === 'running').length + ' running',
        },
        {
            label: 'Session Uptime',
            value: loading ? '...' : stats.uptime,
            icon: Clock,
            color: '#22c55e',
            sub: 'since connection',
        },
        {
            label: 'System Health',
            value: loading ? '...' : (stats.health?.status ?? 'unknown'),
            icon: Server,
            color: stats.health?.status === 'healthy' ? '#22c55e' : '#f97316',
            sub: stats.health?.timestamp ? new Date(stats.health.timestamp).toLocaleTimeString() : '',
        },
    ];

    return (
        <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, maxWidth: 1200, mx: 'auto' }}>
            {/* Header */}
            <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                    <Typography variant="h4" fontWeight="bold" sx={{ fontSize: { xs: '1.5rem', md: '2.125rem' } }}>
                        System Dashboard
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        Live metrics and dynamic service management
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {lastRefresh && (
                        <Typography variant="caption" color="text.secondary">
                            Updated {lastRefresh}
                        </Typography>
                    )}
                    <Tooltip title="Refresh now">
                        <IconButton size="small" onClick={fetchStats}>
                            <RefreshCcw size={18} />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            {loading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

            {/* Session Info Banner */}
            {stats.session && (
                <Paper
                    elevation={0}
                    variant="outlined"
                    sx={{
                        mb: 3,
                        p: 2,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        flexWrap: 'wrap',
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.08))',
                    }}
                >
                    <Box
                        sx={{
                            p: 1,
                            borderRadius: '50%',
                            bgcolor: '#8b5cf615',
                            color: '#8b5cf6',
                            display: 'flex',
                        }}
                    >
                        <User size={20} />
                    </Box>
                    <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="body2" fontWeight="bold">
                            {stats.session.identity}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Session: {stats.session.session_id?.slice(0, 8)}...
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {stats.session.roles?.map((role: string) => (
                            <Chip
                                key={role}
                                icon={<Shield size={12} />}
                                label={role}
                                size="small"
                                color={role === 'admin' ? 'secondary' : 'default'}
                                sx={{ fontWeight: 'bold', fontSize: '0.7rem' }}
                            />
                        ))}
                    </Box>
                </Paper>
            )}

            {/* Stat Cards */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr' },
                    gap: 3,
                    mb: 4
                }}
            >
                {cards.map((c) =>
                    loading ? (
                        <Skeleton key={c.label} variant="rounded" height={100} sx={{ borderRadius: 2 }} />
                    ) : (
                        <Card key={c.label} elevation={0} variant="outlined" sx={{ borderRadius: 2 }}>
                            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Box
                                    sx={{
                                        p: 1.5,
                                        borderRadius: 2,
                                        bgcolor: `${c.color}15`,
                                        color: c.color,
                                        display: 'flex',
                                    }}
                                >
                                    <c.icon size={24} />
                                </Box>
                                <Box>
                                    <Typography variant="body2" color="text.secondary" fontWeight={500}>
                                        {c.label}
                                    </Typography>
                                    <Typography variant="h5" fontWeight="bold">
                                        {c.value}
                                    </Typography>
                                    {c.sub && (
                                        <Typography variant="caption" color="text.secondary">
                                            {c.sub}
                                        </Typography>
                                    )}
                                </Box>
                            </CardContent>
                        </Card>
                    )
                )}
            </Box>

            {/* Multi-Tab Layout */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs value={tabIndex} onChange={handleTabChange} aria-label="dashboard tabs">
                    <Tab icon={<Settings size={18} />} iconPosition="start" label="Runtime Services" />
                    <Tab icon={<BoxIcon size={18} />} iconPosition="start" label="Containers" />
                </Tabs>
            </Box>

            {/* Runtime Services Tab */}
            {tabIndex === 0 && (
                <Paper elevation={0} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                    <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Activity size={18} />
                        <Typography variant="h6" fontWeight="bold">
                            Central Service Registry
                        </Typography>
                        <Chip label={stats.services.length} size="small" sx={{ fontWeight: 'bold' }} />
                    </Box>
                    {stats.services.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary', fontStyle: 'italic' }}>
                            No runtime services discovered either because they are inactive or pending initialization.
                        </Box>
                    ) : (
                        <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                            {stats.services.map((s: any, i: number) => (
                                <Box
                                    key={s.id ?? i}
                                    sx={{
                                        px: 3,
                                        py: 2,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        flexWrap: 'wrap',
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        '&:last-child': { borderBottom: 0 },
                                        '&:hover': { bgcolor: 'action.hover' },
                                    }}
                                >
                                    <Circle
                                        size={12}
                                        fill={s.status === 'running' ? '#22c55e' : s.status === 'stopped' ? '#64748b' : '#ef4444'}
                                        color={s.status === 'running' ? '#22c55e' : s.status === 'stopped' ? '#64748b' : '#ef4444'}
                                    />
                                    <Box sx={{ minWidth: 200, flexGrow: 1 }}>
                                        <Typography variant="body1" fontWeight="bold">
                                            {s.name || s.id}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                                            {s.id}
                                        </Typography>
                                    </Box>
                                    
                                    <Chip
                                        icon={<Cpu size={12} />}
                                        label={s.type}
                                        size="small"
                                        variant="outlined"
                                        sx={{ mr: 1, textTransform: 'capitalize' }}
                                    />
                                    
                                    <Chip
                                        label={s.status}
                                        size="small"
                                        color={s.status === 'running' ? 'success' : 'default'}
                                        sx={{ fontWeight: 'bold', fontSize: '0.65rem' }}
                                    />
                                    
                                    {s.isCritical && (
                                        <Chip label="Critical" size="small" color="error" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                                    )}

                                    <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                                        {s.status === 'running' ? (
                                            <>
                                                <Tooltip title="Restart Service">
                                                    <IconButton size="small" onClick={() => handleServiceAction('restart', s.id)}>
                                                        <RefreshCcw size={16} />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Stop Service">
                                                    <IconButton size="small" color="error" onClick={() => handleServiceAction('stop', s.id)}>
                                                        <Square size={16} />
                                                    </IconButton>
                                                </Tooltip>
                                            </>
                                        ) : (
                                            <Tooltip title="Start Service">
                                                <IconButton size="small" color="success" onClick={() => handleServiceAction('start', s.id)}>
                                                    <Play size={16} />
                                                </IconButton>
                                            </Tooltip>
                                        )}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    )}
                </Paper>
            )}

            {/* Container List Tab */}
            {tabIndex === 1 && (
                <Paper elevation={0} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                    <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BoxIcon size={18} />
                        <Typography variant="h6" fontWeight="bold">
                            Managed Docker Containers
                        </Typography>
                        <Chip label={stats.containerCount} size="small" sx={{ fontWeight: 'bold' }} />
                    </Box>
                    {stats.containers.length === 0 ? (
                        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary', fontStyle: 'italic' }}>
                            No managed containers discovered.
                        </Box>
                    ) : (
                        <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
                            {stats.containers.map((c: any, i: number) => (
                                <Box
                                    key={c.id ?? c.Id ?? i}
                                    sx={{
                                        px: 3,
                                        py: 2,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        '&:last-child': { borderBottom: 0 },
                                        '&:hover': { bgcolor: 'action.hover' },
                                    }}
                                >
                                    <Circle
                                        size={12}
                                        fill="#a855f7"
                                        color="#a855f7"
                                    />
                                    <Box sx={{ flexGrow: 1 }}>
                                        <Typography variant="body1" fontFamily="monospace" fontWeight="bold">
                                            {c.name ?? c.Names?.[0] ?? c.id?.slice(0, 12)}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {c.image ?? c.Image ?? ''}
                                        </Typography>
                                    </Box>
                                    <Chip
                                        label={c.state ?? c.State ?? 'unknown'}
                                        size="small"
                                        color="default"
                                        sx={{ fontWeight: 'bold', fontSize: '0.65rem' }}
                                    />
                                </Box>
                            ))}
                        </Box>
                    )}
                </Paper>
            )}
        </Box>
    );
}
