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
} from '@mui/material';
import { useClient } from '../ClientContext.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardStats {
    processCount: number;
    processes: Array<{ id: string; status: string; pid?: number }>;
    containerCount: number;
    containers: Array<{ id: string; name: string; state: string; image: string }>;
    health: { status: string; timestamp: string } | null;
    session: { identity: string; roles: string[]; session_id: string } | null;
    uptime: string;
}

const INITIAL_STATS: DashboardStats = {
    processCount: 0,
    processes: [],
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

    const fetchStats = useCallback(async () => {
        if (!client) return;

        try {
            const [procRes, containerRes, healthRes, sessionRes] = await Promise.allSettled([
                client.request('process', 'process.list'),
                client.request('container', 'container.list', { all: false }),
                client.request('health', 'check'),
                client.request('session', 'info'),
            ]);

            const processes: DashboardStats['processes'] =
                procRes.status === 'fulfilled' && Array.isArray(procRes.value)
                    ? procRes.value
                    : procRes.status === 'fulfilled' && procRes.value?.processes
                    ? procRes.value.processes
                    : [];

            const containers: DashboardStats['containers'] =
                containerRes.status === 'fulfilled' && Array.isArray(containerRes.value)
                    ? containerRes.value
                    : containerRes.status === 'fulfilled' && containerRes.value?.containers
                    ? containerRes.value.containers
                    : [];

            const health =
                healthRes.status === 'fulfilled' ? healthRes.value : null;

            const session =
                sessionRes.status === 'fulfilled' ? sessionRes.value : null;

            // Calculate uptime
            const uptimeMs = Date.now() - startTimeRef.current;
            const uptimeSec = Math.floor(uptimeMs / 1000);
            const h = Math.floor(uptimeSec / 3600);
            const m = Math.floor((uptimeSec % 3600) / 60);
            const s = uptimeSec % 60;
            const uptime = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;

            setStats({
                processCount: processes.length,
                processes,
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

    // ── Stat Cards ──────────────────────────────────────────────────────

    const cards = [
        {
            label: 'Active Processes',
            value: loading ? '...' : stats.processCount,
            icon: Activity,
            color: '#3b82f6',
            sub: stats.processes
                .filter((p: any) => p.status === 'running')
                .length + ' running',
        },
        {
            label: 'Containers',
            value: loading ? '...' : stats.containerCount,
            icon: BoxIcon,
            color: '#a855f7',
            sub: stats.containers
                .filter((c: any) => c.state === 'running' || c.State === 'running')
                .length + ' running',
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
            sub: stats.health?.timestamp
                ? new Date(stats.health.timestamp).toLocaleTimeString()
                : '',
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
                        Live metrics from the Orchestrator Daemon
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
                }}
            >
                {cards.map((c) =>
                    loading ? (
                        <Skeleton
                            key={c.label}
                            variant="rounded"
                            height={100}
                            sx={{ borderRadius: 2 }}
                        />
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

            {/* Process List */}
            <Paper elevation={0} variant="outlined" sx={{ mt: 4, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Activity size={18} />
                    <Typography variant="h6" fontWeight="bold">
                        Managed Processes
                    </Typography>
                    <Chip label={stats.processCount} size="small" sx={{ fontWeight: 'bold' }} />
                </Box>
                {stats.processes.length === 0 ? (
                    <Box sx={{ p: 3, color: 'text.secondary', fontStyle: 'italic' }}>
                        No managed processes
                    </Box>
                ) : (
                    <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {stats.processes.map((p: any, i: number) => (
                            <Box
                                key={p.id ?? i}
                                sx={{
                                    px: 3,
                                    py: 1.5,
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
                                    size={10}
                                    fill={p.status === 'running' ? '#22c55e' : '#ef4444'}
                                    color={p.status === 'running' ? '#22c55e' : '#ef4444'}
                                />
                                <Typography variant="body2" fontFamily="monospace" fontWeight="bold" sx={{ flexGrow: 1 }}>
                                    {p.id}
                                </Typography>
                                <Chip
                                    label={p.status}
                                    size="small"
                                    color={p.status === 'running' ? 'success' : 'error'}
                                    sx={{ fontWeight: 'bold', fontSize: '0.65rem', height: 20 }}
                                />
                                {p.pid && (
                                    <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                                        PID {p.pid}
                                    </Typography>
                                )}
                            </Box>
                        ))}
                    </Box>
                )}
            </Paper>

            {/* Container List */}
            <Paper elevation={0} variant="outlined" sx={{ mt: 3, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BoxIcon size={18} />
                    <Typography variant="h6" fontWeight="bold">
                        Running Containers
                    </Typography>
                    <Chip label={stats.containerCount} size="small" sx={{ fontWeight: 'bold' }} />
                </Box>
                {stats.containers.length === 0 ? (
                    <Box sx={{ p: 3, color: 'text.secondary', fontStyle: 'italic' }}>
                        No running containers
                    </Box>
                ) : (
                    <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                        {stats.containers.map((c: any, i: number) => (
                            <Box
                                key={c.id ?? c.Id ?? i}
                                sx={{
                                    px: 3,
                                    py: 1.5,
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
                                    size={10}
                                    fill="#a855f7"
                                    color="#a855f7"
                                />
                                <Typography variant="body2" fontFamily="monospace" fontWeight="bold" sx={{ flexGrow: 1 }}>
                                    {c.name ?? c.Names?.[0] ?? c.id?.slice(0, 12)}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {c.image ?? c.Image ?? ''}
                                </Typography>
                                <Chip
                                    label={c.state ?? c.State ?? 'unknown'}
                                    size="small"
                                    color="default"
                                    sx={{ fontWeight: 'bold', fontSize: '0.65rem', height: 20 }}
                                />
                            </Box>
                        ))}
                    </Box>
                )}
            </Paper>
        </Box>
    );
}
