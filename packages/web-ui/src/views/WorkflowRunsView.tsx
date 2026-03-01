/**
 * WorkflowRunsView — Workflow execution monitor.
 * Lists all runs with status, lets you drill into step-by-step results,
 * and stream live output for in-progress runs.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Box, Paper, Typography, Chip, CircularProgress, Alert, Select, MenuItem,
    FormControl, InputLabel, IconButton, Tooltip, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow, Collapse,
    Button, LinearProgress, useTheme,
} from '@mui/material';
import { useClient } from '../ClientContext.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Execution {
    id: string;
    workflowId: string;
    workflowName?: string;
    status: 'running' | 'completed' | 'failed';
    input: string;
    finalOutput: string | null;
    startedAt: string;
    completedAt: string | null;
}

interface StepExecution {
    id: string;
    executionId: string;
    nodeId: string;
    status: 'running' | 'completed' | 'failed';
    output: string | null;
    error: string | null;
    startedAt: string;
    completedAt: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: string): 'info' | 'success' | 'error' | 'default' | 'warning' {
    if (s === 'running')   return 'info';
    if (s === 'completed') return 'success';
    if (s === 'failed')    return 'error';
    return 'default';
}

function duration(start: string, end: string | null): string {
    if (!end) return '…';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000)  return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(iso).toLocaleDateString();
}

function workflowEventToText(chunk: any): string | null {
    if (!chunk || typeof chunk !== 'object' || typeof chunk.type !== 'string') return null;
    if (!chunk.type.startsWith('workflow.')) return null;
    if (chunk.type === 'workflow.start') return '▶ Workflow started\n';
    if (chunk.type === 'workflow.complete') return '✅ Workflow completed\n';
    if (chunk.type === 'workflow.error') return `❌ Workflow failed: ${chunk.error || 'unknown error'}\n`;
    if (chunk.type === 'workflow.step.start') return `⏳ Step ${chunk.stepId || '?'} started\n`;
    if (chunk.type === 'workflow.step.complete') return `✅ Step ${chunk.stepId || '?'} completed\n`;
    return `${chunk.type}\n`;
}

// ─── Step timeline row ────────────────────────────────────────────────────────

function StepRow({ step }: { step: StepExecution }) {
    const [expanded, setExpanded] = useState(false);
    const hasDetail = !!(step.output || step.error);
    return (
        <>
            <TableRow
                hover
                sx={{ cursor: hasDetail ? 'pointer' : 'default', '& td': { py: 0.75 } }}
                onClick={() => hasDetail && setExpanded(e => !e)}
            >
                <TableCell sx={{ pl: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            bgcolor: step.status === 'completed' ? 'success.main' :
                                     step.status === 'failed'    ? 'error.main' : 'info.main',
                        }} />
                        <Typography variant="body2" fontFamily="monospace">{step.nodeId}</Typography>
                    </Box>
                </TableCell>
                <TableCell>
                    <Chip label={step.status} size="small" color={statusColor(step.status)} />
                </TableCell>
                <TableCell>
                    <Typography variant="caption" color="text.secondary">
                        {duration(step.startedAt, step.completedAt)}
                    </Typography>
                </TableCell>
                <TableCell>
                    {hasDetail && (
                        <IconButton size="small">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </IconButton>
                    )}
                </TableCell>
            </TableRow>
            {hasDetail && (
                <TableRow>
                    <TableCell colSpan={4} sx={{ p: 0 }}>
                        <Collapse in={expanded}>
                            <Box sx={{
                                mx: 4, my: 1, p: 1.5, borderRadius: 1.5,
                                bgcolor: 'background.default',
                                border: '1px solid', borderColor: 'divider',
                                fontFamily: 'monospace', fontSize: '0.8rem',
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                maxHeight: 200, overflowY: 'auto',
                            }}>
                                {step.error
                                    ? <Typography color="error.main" variant="body2" fontFamily="monospace">{step.error}</Typography>
                                    : step.output}
                            </Box>
                        </Collapse>
                    </TableCell>
                </TableRow>
            )}
        </>
    );
}

// ─── Execution row ────────────────────────────────────────────────────────────

function ExecutionRow({ exec, client }: { exec: Execution; client: any }) {
    const [expanded, setExpanded] = useState(false);
    const [steps, setSteps] = useState<StepExecution[]>([]);
    const [loadingSteps, setLoadingSteps] = useState(false);
    const [liveOutput, setLiveOutput] = useState<string[]>([]);
    const [streaming, setStreaming] = useState(false);
    const liveRef = useRef<HTMLDivElement>(null);

    const toggleExpand = async () => {
        if (!expanded) {
            setLoadingSteps(true);
            try {
                const res = await client.agent.listWorkflowStepExecutions(exec.id);
                setSteps(res.steps ?? []);
            } catch { /* ignore */ }
            finally { setLoadingSteps(false); }
        }
        setExpanded(e => !e);
    };

    // Live stream for running executions
    const streamExecution = async () => {
        if (!client || !exec.workflowId) return;
        setLiveOutput([]);
        setStreaming(true);
        try {
            const stream = client.agent.runWorkflowExec(exec.workflowId, exec.input || 'replay');
            for await (const chunk of stream) {
                const evText = workflowEventToText(chunk);
                if (evText) {
                    setLiveOutput(prev => [...prev, evText]);
                    liveRef.current?.scrollIntoView({ behavior: 'smooth' });
                    continue;
                }
                const text =
                    typeof chunk === 'string' ? chunk :
                    chunk?.content?.parts?.[0]?.text ?? chunk?.text ??
                    (typeof chunk?.content === 'string' ? chunk.content : null) ??
                    (chunk ? JSON.stringify(chunk) : null);
                if (text) setLiveOutput(prev => [...prev, text]);
                liveRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
        } catch { /* ignore */ }
        finally { setStreaming(false); }
    };

    return (
        <>
            <TableRow
                hover
                sx={{ cursor: 'pointer', '& td': { verticalAlign: 'middle' } }}
                onClick={toggleExpand}
            >
                <TableCell>
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 200 }}>
                        {exec.workflowName ?? exec.workflowId.slice(0, 8)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                        {exec.id.slice(0, 12)}…
                    </Typography>
                </TableCell>
                <TableCell>
                    <Chip label={exec.status} size="small" color={statusColor(exec.status)} />
                </TableCell>
                <TableCell>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 160 }} title={exec.input}>
                        {exec.input.slice(0, 40)}{exec.input.length > 40 ? '…' : ''}
                    </Typography>
                </TableCell>
                <TableCell>
                    <Typography variant="caption" color="text.secondary">
                        {relativeTime(exec.startedAt)}
                    </Typography>
                </TableCell>
                <TableCell>
                    <Typography variant="caption" color="text.secondary">
                        {duration(exec.startedAt, exec.completedAt)}
                    </Typography>
                </TableCell>
                <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {exec.status === 'running' && (
                            <Tooltip title="Stream live output">
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); streamExecution(); }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polygon points="5 3 19 12 5 21 5 3"/>
                                    </svg>
                                </IconButton>
                            </Tooltip>
                        )}
                        <IconButton size="small" onClick={toggleExpand}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </IconButton>
                    </Box>
                </TableCell>
            </TableRow>

            {/* Expanded detail */}
            <TableRow>
                <TableCell colSpan={6} sx={{ p: 0, borderBottom: expanded ? undefined : 'none' }}>
                    <Collapse in={expanded}>
                        <Box sx={{ bgcolor: 'background.default' }}>
                            {exec.status === 'running' && <LinearProgress />}
                            {loadingSteps && (
                                <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
                                    <CircularProgress size={16} />
                                    <Typography variant="body2" color="text.secondary">Loading steps…</Typography>
                                </Box>
                            )}

                            {/* Step table */}
                            {steps.length > 0 && (
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={{ '& th': { bgcolor: 'background.default', fontWeight: 700, py: 0.5 } }}>
                                            <TableCell sx={{ pl: 4 }}>Node</TableCell>
                                            <TableCell>Status</TableCell>
                                            <TableCell>Duration</TableCell>
                                            <TableCell />
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {steps.map(s => <StepRow key={s.id} step={s} />)}
                                    </TableBody>
                                </Table>
                            )}

                            {/* Final output */}
                            {exec.finalOutput && (
                                <Box sx={{ p: 2 }}>
                                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                        FINAL OUTPUT
                                    </Typography>
                                    <Box sx={{
                                        p: 1.5, borderRadius: 1.5, bgcolor: 'background.paper',
                                        border: '1px solid', borderColor: 'divider',
                                        fontFamily: 'monospace', fontSize: '0.8rem',
                                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                        maxHeight: 300, overflowY: 'auto',
                                    }}>
                                        {exec.finalOutput}
                                    </Box>
                                </Box>
                            )}

                            {/* Live stream output */}
                            {(streaming || liveOutput.length > 0) && (
                                <Box sx={{ p: 2, pt: 0 }}>
                                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                        LIVE OUTPUT {streaming && <CircularProgress size={10} sx={{ ml: 0.5 }} />}
                                    </Typography>
                                    <Box sx={{
                                        p: 1.5, borderRadius: 1.5, bgcolor: 'background.paper',
                                        border: '1px solid', borderColor: 'info.main',
                                        fontFamily: 'monospace', fontSize: '0.8rem',
                                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                        maxHeight: 200, overflowY: 'auto',
                                    }}>
                                        {liveOutput.join('')}
                                        <div ref={liveRef} />
                                    </Box>
                                </Box>
                            )}

                            {steps.length === 0 && !loadingSteps && !exec.finalOutput && !streaming && (
                                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                                    No step details available.
                                </Typography>
                            )}
                        </Box>
                    </Collapse>
                </TableCell>
            </TableRow>
        </>
    );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function WorkflowRunsView() {
    const client = useClient();
    const theme = useTheme();

    const [executions, setExecutions] = useState<Execution[]>([]);
    const [workflows, setWorkflows]   = useState<any[]>([]);
    const [filterWf, setFilterWf]     = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [loading, setLoading]       = useState(false);
    const [error, setError]           = useState<string | null>(null);
    const [polling, setPolling]       = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval>>();

    const loadExecutions = useCallback(async () => {
        if (!client) return;
        setLoading(true);
        setError(null);
        try {
            const [exRes, wfRes] = await Promise.all([
                client.agent.listWorkflowExecutions(filterWf || undefined),
                client.agent.listWorkflowConfigs(),
            ]);
            setExecutions(exRes.executions ?? []);
            setWorkflows(wfRes.workflows ?? []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [client, filterWf]);

    useEffect(() => { loadExecutions(); }, [loadExecutions]);

    // Auto-poll every 5 s if any execution is running
    useEffect(() => {
        const hasRunning = executions.some(e => e.status === 'running');
        if (hasRunning && !pollRef.current) {
            setPolling(true);
            pollRef.current = setInterval(loadExecutions, 5000);
        } else if (!hasRunning && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = undefined;
            setPolling(false);
        }
        return () => {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined; }
        };
    }, [executions, loadExecutions]);

    const filtered = useMemo(() => executions.filter(e =>
        (!filterStatus || e.status === filterStatus)
    ), [executions, filterStatus]);

    const { runningCount, completedCount, failedCount } = useMemo(() => {
        let running = 0, completed = 0, failed = 0;
        for (const e of executions) {
            if (e.status === 'running') running++;
            else if (e.status === 'completed') completed++;
            else if (e.status === 'failed') failed++;
        }
        return { runningCount: running, completedCount: completed, failedCount: failed };
    }, [executions]);

    return (
        <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
            {/* Header */}
            <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="h5" fontWeight={700}>Workflow Runs</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Execution history and live monitoring
                    </Typography>
                </Box>
                <Tooltip title="Refresh">
                    <IconButton onClick={loadExecutions} disabled={loading}>
                        {loading
                            ? <CircularProgress size={20} />
                            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                              </svg>}
                    </IconButton>
                </Tooltip>
                {polling && <Chip label="Live" size="small" color="info" />}
            </Box>

            {/* Summary cards */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                {[
                    { label: 'Running',   value: runningCount,   color: theme.palette.info.main },
                    { label: 'Completed', value: completedCount, color: theme.palette.success.main },
                    { label: 'Failed',    value: failedCount,    color: theme.palette.error.main },
                    { label: 'Total',     value: executions.length, color: theme.palette.text.secondary },
                ].map(({ label, value, color }) => (
                    <Paper key={label} elevation={0} sx={{
                        px: 3, py: 2, borderRadius: 2, minWidth: 120, flexGrow: 1,
                        border: '1px solid', borderColor: 'divider', textAlign: 'center',
                    }}>
                        <Typography variant="h4" fontWeight={700} sx={{ color }}>{value}</Typography>
                        <Typography variant="caption" color="text.secondary">{label}</Typography>
                    </Paper>
                ))}
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {/* Filters */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Workflow</InputLabel>
                    <Select value={filterWf} label="Workflow" onChange={(e) => setFilterWf(e.target.value)}>
                        <MenuItem value=""><em>All workflows</em></MenuItem>
                        {workflows.map(w => <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>)}
                    </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Status</InputLabel>
                    <Select value={filterStatus} label="Status" onChange={(e) => setFilterStatus(e.target.value)}>
                        <MenuItem value=""><em>All statuses</em></MenuItem>
                        <MenuItem value="running">Running</MenuItem>
                        <MenuItem value="completed">Completed</MenuItem>
                        <MenuItem value="failed">Failed</MenuItem>
                    </Select>
                </FormControl>
                {(filterWf || filterStatus) && (
                    <Button size="small" variant="text" onClick={() => { setFilterWf(''); setFilterStatus(''); }}>
                        Clear filters
                    </Button>
                )}
            </Box>

            {/* Executions table */}
            <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                {loading && <LinearProgress />}
                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'action.hover' } }}>
                                <TableCell>Workflow</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Input</TableCell>
                                <TableCell>Started</TableCell>
                                <TableCell>Duration</TableCell>
                                <TableCell />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filtered.length === 0 && !loading && (
                                <TableRow>
                                    <TableCell colSpan={6} sx={{ textAlign: 'center', py: 6 }}>
                                        <Typography variant="body2" color="text.secondary">
                                            No executions found
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                            {filtered.map(exec => (
                                <ExecutionRow key={exec.id} exec={exec} client={client} />
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>
        </Box>
    );
}
