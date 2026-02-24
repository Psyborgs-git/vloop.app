/**
 * AIConfigView — Main tabbed container for all AI configuration CRUD.
 *
 * Tabs: Providers | Models | Tools | Agents | Workflows | Memory
 */

import { useState } from 'react';
import { Box, Tabs, Tab, Typography, Paper } from '@mui/material';
import { Sparkles } from 'lucide-react';
import ProviderList from '../components/ai/ProviderList.js';
import ModelList from '../components/ai/ModelList.js';
import ToolList from '../components/ai/ToolList.js';
import AgentList from '../components/ai/AgentList.js';
import WorkflowList from '../components/ai/WorkflowList.js';
import MemoryList from '../components/ai/MemoryList.js';

const TABS = [
    { label: 'Providers', component: ProviderList },
    { label: 'Models', component: ModelList },
    { label: 'Tools', component: ToolList },
    { label: 'Agents', component: AgentList },
    { label: 'Workflows', component: WorkflowList },
    { label: 'Memory', component: MemoryList },
];

export default function AIConfigView() {
    const [tab, setTab] = useState(0);
    const ActiveComponent = TABS[tab]!.component;

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <Box sx={{ px: 3, pt: 3, pb: 1 }}>
                <Typography variant="h5" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                    <Sparkles size={24} /> AI Configuration
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Manage providers, models, tools, agents, workflows, and memory for your AI system.
                </Typography>
            </Box>

            {/* Tabs */}
            <Box sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                        '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 },
                    }}
                >
                    {TABS.map((t, i) => (
                        <Tab key={i} label={t.label} />
                    ))}
                </Tabs>
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
                <Paper elevation={0} sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
                    <ActiveComponent />
                </Paper>
            </Box>
        </Box>
    );
}
