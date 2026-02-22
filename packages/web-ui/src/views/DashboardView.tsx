
import { useEffect, useState } from 'react';
import { Activity, Box as BoxIcon, Server, Clock } from 'lucide-react';
import { Box, Card, CardContent, Typography, Paper } from '@mui/material';
import type { OrchestratorClient } from '@orch/client';

interface DashboardProps {
    client: OrchestratorClient | null;
}

export default function DashboardView({ client }: DashboardProps) {
    const [stats, setStats] = useState({ processCount: 0, containerCount: 0 });

    useEffect(() => {
        let isIntervalActive = true;

        async function fetchStats() {
            if (!client || !isIntervalActive) return;
            try {
                // Future integration to fetch real process / container counts via SDK.
                // const processes = await client.process.list();
                // const containers = await client.container.list();
                setStats({ processCount: 3, containerCount: 2 });
            } catch (err) {
                console.error(err);
            }
        }

        if (client) {
            fetchStats();
            const interval = setInterval(fetchStats, 5000);
            return () => {
                isIntervalActive = false;
                clearInterval(interval);
            };
        }
    }, [client]);

    const cards = [
        { label: 'Active Processes', value: stats.processCount, icon: Activity, color: '#3b82f6' },
        { label: 'Running Containers', value: stats.containerCount, icon: BoxIcon, color: '#a855f7' },
        { label: 'Daemon Uptime', value: 'Live', icon: Clock, color: '#22c55e' },
        { label: 'System Load', value: 'Nominal', icon: Server, color: '#f97316' },
    ];

    return (
        <Box sx={{ p: 4, maxWidth: 1200, mx: 'auto' }}>
            <Box sx={{ mb: 4 }}>
                <Typography variant="h4" fontWeight="bold">System Dashboard</Typography>
                <Typography variant="body1" color="text.secondary">Real-time metrics from the Orchestrator Daemon</Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr' }, gap: 3 }}>
                {cards.map((c) => (
                    <Card key={c.label} elevation={0} variant="outlined" sx={{ borderRadius: 2 }}>
                        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: `${c.color}15`, color: c.color, display: 'flex' }}>
                                <c.icon size={24} />
                            </Box>
                            <Box>
                                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                                    {c.label}
                                </Typography>
                                <Typography variant="h5" fontWeight="bold">
                                    {c.value}
                                </Typography>
                            </Box>
                        </CardContent>
                    </Card>
                ))}
            </Box>

            <Paper elevation={0} variant="outlined" sx={{ mt: 4, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ px: 3, py: 2, borderBottom: 1, borderColor: 'divider' }}>
                    <Typography variant="h6" fontWeight="bold">Recent Logs</Typography>
                </Box>
                <Box sx={{ p: 3, bgcolor: '#0f172a', color: '#4ade80', fontFamily: 'monospace', fontSize: '0.875rem', height: 256, overflowY: 'auto' }}>
                    <Box>[08:12:33] Daemon started successfully on port 9001</Box>
                    <Box>[08:12:34] Loaded 4 core plugins</Box>
                    <Box>[08:14:02] WebSocket connection received from 127.0.0.1</Box>
                    <Box sx={{ animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}>_</Box>
                </Box>
            </Paper>
        </Box>
    );
}
