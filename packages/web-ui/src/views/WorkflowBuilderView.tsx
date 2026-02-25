/**
 * WorkflowBuilderView — Visual workflow editor using @xyflow/react.
 * Features: list+load existing workflows, multiple node types,
 * create/edit/run workflows, real-time execution output.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    ReactFlow, MiniMap, Controls, Background, BackgroundVariant,
    useNodesState, useEdgesState, addEdge, Connection, Edge, Node,
    Panel, NodeProps, Handle, Position, MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    Box, Button, Typography, Paper, Select, MenuItem, FormControl, InputLabel,
    TextField, Chip, IconButton, Divider, List, ListItemButton, ListItemText,
    Tooltip, CircularProgress, Alert, Collapse, Drawer, useMediaQuery, useTheme,
    ToggleButtonGroup, ToggleButton, Snackbar,
} from '@mui/material';
import { useClient } from '../ClientContext.js';

// ─── Node type palette ────────────────────────────────────────────────────────

type NodeKind = 'input' | 'output' | 'agent' | 'llm' | 'condition' | 'merge';

const NODE_META: Record<NodeKind, { label: string; color: string; description: string }> = {
    input:     { label: 'Input',     color: '#4caf50', description: 'Workflow entry point — receives the initial prompt' },
    output:    { label: 'Output',    color: '#f44336', description: 'Workflow exit point — emits the final result' },
    agent:     { label: 'Agent',     color: '#2196f3', description: 'Run a configured AI agent' },
    llm:       { label: 'LLM Call',  color: '#9c27b0', description: 'Direct LLM call with a custom prompt template' },
    condition: { label: 'Condition', color: '#ff9800', description: 'Branch on a JavaScript condition expression' },
    merge:     { label: 'Merge',     color: '#607d8b', description: 'Join multiple parallel branches' },
};

// ─── Custom node renderers ────────────────────────────────────────────────────

function WorkflowNode({ data, selected }: NodeProps) {
    const kind = (data.kind as NodeKind) ?? 'agent';
    const meta = NODE_META[kind] ?? NODE_META.agent;
    const showTarget = kind !== 'input';
    const showSource = kind !== 'output';
    return (
        <Box sx={{
            minWidth: 140, px: 2, py: 1.5, borderRadius: 2,
            bgcolor: 'background.paper',
            border: `2px solid ${selected ? meta.color : 'rgba(0,0,0,0.15)'}`,
            boxShadow: selected ? `0 0 0 3px ${meta.color}44` : '0 2px 8px rgba(0,0,0,0.12)',
            transition: 'box-shadow 0.15s, border-color 0.15s',
        }}>
            {showTarget && <Handle type="target" position={Position.Top} />}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: meta.color, flexShrink: 0 }} />
                <Typography variant="caption" fontWeight={700} color="text.secondary">{meta.label}</Typography>
            </Box>
            <Typography variant="body2" fontWeight={600} noWrap sx={{ mt: 0.25 }}>
                {(data.label as string) || meta.label}
            </Typography>
            {kind === 'condition' && (
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {(data.condition as string) || 'condition…'}
                </Typography>
            )}
            {showSource && kind !== 'condition' && <Handle type="source" position={Position.Bottom} />}
            {kind === 'condition' && (
                <>
                    <Handle type="source" position={Position.Bottom} id="true"
                        style={{ left: '30%' }} />
                    <Handle type="source" position={Position.Bottom} id="false"
                        style={{ left: '70%' }} />
                </>
            )}
        </Box>
    );
}

const nodeTypes = { workflowNode: WorkflowNode };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BLANK_NODES: Node[] = [
    { id: 'input',  type: 'workflowNode', position: { x: 200, y: 40  }, data: { label: 'Start', kind: 'input' } },
    { id: 'output', type: 'workflowNode', position: { x: 200, y: 340 }, data: { label: 'End',   kind: 'output' } },
];
const BLANK_EDGES: Edge[] = [];

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkflowBuilderView() {
    const client = useClient();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    // Canvas state
    const [nodes, setNodes, onNodesChange] = useNodesState(BLANK_NODES);
    const [edges, setEdges, onEdgesChange] = useEdgesState(BLANK_EDGES);
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);

    // Workflow metadata
    const [workflows, setWorkflows]     = useState<any[]>([]);
    const [editingId, setEditingId]     = useState<string | null>(null);
    const [wfName, setWfName]           = useState('My Workflow');
    const [wfDesc, setWfDesc]           = useState('');
    const [wfType, setWfType]           = useState<'sequential' | 'parallel'>('sequential');

    // Config data
    const [agents, setAgents] = useState<any[]>([]);
    const [models, setModels] = useState<any[]>([]);

    // Execution
    const [runInput, setRunInput]           = useState('');
    const [runOutput, setRunOutput]         = useState<string[]>([]);
    const [running, setRunning]             = useState(false);
    const [runError, setRunError]           = useState<string | null>(null);
    const [execPanelOpen, setExecPanelOpen] = useState(false);

    // UI
    const [saving, setSaving]               = useState(false);
    const [snack, setSnack]                 = useState<string | null>(null);
    const [listOpen, setListOpen]           = useState(!isMobile);
    const outputEndRef = useRef<HTMLDivElement>(null);

    // ─── Load data ───────────────────────────────────────────────────────

    useEffect(() => {
        if (!client) return;
        Promise.all([
            client.agent.listWorkflowConfigs(),
            client.agent.listAgents(),
            client.agent.listModels(),
        ]).then(([wfRes, agRes, modRes]) => {
            setWorkflows(wfRes.workflows ?? []);
            setAgents(agRes.agents ?? []);
            setModels(modRes.models ?? []);
        }).catch(console.error);
    }, [client]);

    useEffect(() => {
        outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [runOutput]);

    // ─── Canvas actions ──────────────────────────────────────────────────

    const onConnect = useCallback(
        (params: Connection | Edge) => setEdges(eds => addEdge(params, eds)),
        [setEdges],
    );

    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedNode(node);
    }, []);

    const onPaneClick = useCallback(() => setSelectedNode(null), []);

    const addNode = (kind: NodeKind) => {
        const meta = NODE_META[kind];
        const newNode: Node = {
            id: `${kind}_${Date.now()}`,
            type: 'workflowNode',
            position: { x: 150 + Math.random() * 200, y: 150 + Math.random() * 150 },
            data: { label: meta.label, kind },
        };
        setNodes(nds => [...nds, newNode]);
    };

    const updateNodeData = (key: string, value: any) => {
        if (!selectedNode) return;
        setNodes(nds => nds.map(n => {
            if (n.id !== selectedNode.id) return n;
            const updated = { ...n, data: { ...n.data, [key]: value } };
            // Auto-label from agent or model
            if (key === 'agentId') {
                const ag = agents.find(a => a.id === value);
                if (ag) updated.data.label = ag.name;
            }
            if (key === 'modelId') {
                const mo = models.find(m => m.id === value);
                if (mo) updated.data.label = mo.name;
            }
            setSelectedNode(updated);
            return updated;
        }));
    };

    const deleteSelectedNode = () => {
        if (!selectedNode) return;
        const id = selectedNode.id;
        setNodes(nds => nds.filter(n => n.id !== id));
        setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
        setSelectedNode(null);
    };

    // ─── Load existing workflow into canvas ──────────────────────────────

    const loadWorkflow = (wf: any) => {
        setEditingId(wf.id);
        setWfName(wf.name);
        setWfDesc(wf.description ?? '');
        setWfType(wf.type ?? 'sequential');
        const loadedNodes: Node[] = (wf.nodes ?? []).map((n: any) => ({
            id: n.id,
            type: 'workflowNode',
            position: n.position ?? { x: 100, y: 100 },
            data: { ...n.data, label: n.data?.label ?? n.id },
        }));
        const loadedEdges: Edge[] = (wf.edges ?? []).map((e: any) => ({
            id: e.id ?? `e-${e.source}-${e.target}`,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            label: e.label,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
        }));
        setNodes(loadedNodes.length > 0 ? loadedNodes : BLANK_NODES);
        setEdges(loadedEdges);
        setSelectedNode(null);
        if (isMobile) setListOpen(false);
    };

    const newWorkflow = () => {
        setEditingId(null);
        setWfName('My Workflow');
        setWfDesc('');
        setWfType('sequential');
        setNodes(BLANK_NODES);
        setEdges(BLANK_EDGES);
        setSelectedNode(null);
        if (isMobile) setListOpen(false);
    };

    // ─── Save / Update ───────────────────────────────────────────────────

    const serializeGraph = () => ({
        name: wfName.trim() || 'Untitled Workflow',
        description: wfDesc,
        type: wfType,
        nodes: nodes.map(n => ({
            id: n.id,
            type: (n.data.kind as string) ?? n.type,
            position: n.position,
            data: n.data,
        })),
        edges: edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null,
            label: e.label ?? null,
        })),
    });

    const saveWorkflow = async () => {
        if (!client) return;
        setSaving(true);
        try {
            const payload = serializeGraph();
            let saved: any;
            if (editingId) {
                saved = await client.agent.updateWorkflowConfig(editingId, payload);
                setWorkflows(prev => prev.map(w => w.id === saved.id ? saved : w));
                setSnack('Workflow updated');
            } else {
                saved = await client.agent.createWorkflowConfig(payload);
                setWorkflows(prev => [saved, ...prev]);
                setEditingId(saved.id);
                setSnack('Workflow created');
            }
        } catch (err: any) {
            setSnack(`Save failed: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const deleteWorkflow = async (id: string) => {
        if (!client) return;
        await client.agent.deleteWorkflowConfig(id);
        setWorkflows(prev => prev.filter(w => w.id !== id));
        if (editingId === id) newWorkflow();
    };

    // ─── Run ─────────────────────────────────────────────────────────────

    const runWorkflow = async () => {
        if (!client || !editingId) return;
        setRunOutput([]);
        setRunError(null);
        setRunning(true);
        setExecPanelOpen(true);
        try {
            const stream = client.agent.runWorkflowExec(editingId, runInput || 'run');
            for await (const chunk of stream) {
                const text =
                    typeof chunk === 'string' ? chunk :
                    chunk?.content?.parts?.[0]?.text ??
                    chunk?.text ??
                    (typeof chunk?.content === 'string' ? chunk.content : null) ??
                    (chunk ? JSON.stringify(chunk) : null);
                if (text) setRunOutput(prev => [...prev, text]);
            }
        } catch (err: any) {
            setRunError(err.message);
        } finally {
            setRunning(false);
        }
    };

    // ─── Render helpers ──────────────────────────────────────────────────

    const WorkflowList = (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                <Button variant="contained" fullWidth size="small" onClick={newWorkflow}>
                    + New Workflow
                </Button>
            </Box>
            <List sx={{ flexGrow: 1, overflowY: 'auto', p: 0.5 }} dense>
                {workflows.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                        No workflows yet
                    </Typography>
                )}
                {workflows.map(wf => (
                    <ListItemButton
                        key={wf.id}
                        selected={editingId === wf.id}
                        onClick={() => loadWorkflow(wf)}
                        sx={{ borderRadius: 1, mb: 0.25, pr: 0.5 }}
                    >
                        <ListItemText
                            primary={wf.name}
                            secondary={wf.type}
                            slotProps={{ primary: { variant: 'body2', noWrap: true, fontWeight: editingId === wf.id ? 700 : 400 } }}
                        />
                        <Tooltip title="Delete workflow">
                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteWorkflow(wf.id); }}
                                sx={{ flexShrink: 0, color: 'error.main', opacity: 0.6, '&:hover': { opacity: 1 } }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </IconButton>
                        </Tooltip>
                    </ListItemButton>
                ))}
            </List>
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>

            {/* Workflow list — permanent sidebar on desktop, drawer on mobile */}
            {isMobile ? (
                <Drawer anchor="left" open={listOpen} onClose={() => setListOpen(false)}
                    PaperProps={{ sx: { width: 240 } }}>
                    {WorkflowList}
                </Drawer>
            ) : (
                <Paper elevation={0} sx={{
                    width: 220, flexShrink: 0, borderRight: 1, borderColor: 'divider',
                    display: 'flex', flexDirection: 'column', borderRadius: 0,
                }}>
                    {WorkflowList}
                </Paper>
            )}

            {/* Main canvas area */}
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                {/* Top toolbar */}
                <Box sx={{
                    px: 2, py: 1, borderBottom: 1, borderColor: 'divider',
                    display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
                    bgcolor: 'background.paper',
                }}>
                    {isMobile && (
                        <Tooltip title="Workflows">
                            <IconButton size="small" onClick={() => setListOpen(true)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                            </IconButton>
                        </Tooltip>
                    )}
                    <TextField
                        size="small"
                        value={wfName}
                        onChange={(e) => setWfName(e.target.value)}
                        variant="outlined"
                        sx={{ width: 180 }}
                        slotProps={{ input: { sx: { fontWeight: 600 } } }}
                    />
                    <ToggleButtonGroup size="small" exclusive
                        value={wfType} onChange={(_, v) => v && setWfType(v)}>
                        <ToggleButton value="sequential">Sequential</ToggleButton>
                        <ToggleButton value="parallel">Parallel</ToggleButton>
                    </ToggleButtonGroup>

                    {/* Node palette */}
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {(Object.entries(NODE_META) as [NodeKind, any][]).filter(([k]) => !['input','output'].includes(k)).map(([kind, meta]) => (
                            <Tooltip key={kind} title={meta.description}>
                                <Button size="small" variant="outlined"
                                    onClick={() => addNode(kind)}
                                    sx={{
                                        borderColor: meta.color, color: meta.color,
                                        '&:hover': { bgcolor: `${meta.color}14` },
                                        minWidth: 0, px: 1.2, py: 0.4, fontSize: '0.72rem',
                                    }}>
                                    + {meta.label}
                                </Button>
                            </Tooltip>
                        ))}
                    </Box>

                    <Box sx={{ flexGrow: 1 }} />
                    <Button variant="outlined" size="small" onClick={() => setExecPanelOpen(p => !p)}>
                        {execPanelOpen ? 'Hide Output' : 'Output'}
                    </Button>
                    <Button
                        variant="outlined" color="success" size="small" disabled={!editingId || running}
                        onClick={runWorkflow}
                        startIcon={running ? <CircularProgress size={14} /> : undefined}
                    >
                        {running ? 'Running…' : 'Run'}
                    </Button>
                    <Button variant="contained" size="small" onClick={saveWorkflow} disabled={saving}>
                        {saving ? <CircularProgress size={14} /> : editingId ? 'Update' : 'Create'}
                    </Button>
                </Box>

                <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
                    {/* Canvas */}
                    <Box sx={{ flexGrow: 1, position: 'relative' }}>
                        <ReactFlow
                            nodes={nodes} edges={edges}
                            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
                            onConnect={onConnect} onNodeClick={onNodeClick} onPaneClick={onPaneClick}
                            nodeTypes={nodeTypes}
                            fitView
                            defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } }}
                        >
                            <Controls />
                            <MiniMap nodeColor={(n) => NODE_META[(n.data?.kind as NodeKind) ?? 'agent']?.color ?? '#999'} />
                            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
                            {!editingId && (
                                <Panel position="top-center">
                                    <Chip
                                        label="Unsaved workflow — click Create to save"
                                        color="warning" size="small"
                                    />
                                </Panel>
                            )}
                        </ReactFlow>
                    </Box>

                    {/* Node inspector panel */}
                    {selectedNode && (
                        <Paper elevation={0} sx={{
                            width: 280, borderLeft: 1, borderColor: 'divider',
                            p: 2, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto',
                        }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Typography variant="subtitle2" fontWeight={700}>Node Inspector</Typography>
                                <IconButton size="small" onClick={() => setSelectedNode(null)}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </IconButton>
                            </Box>
                            <Chip
                                label={NODE_META[(selectedNode.data.kind as NodeKind) ?? 'agent']?.label}
                                size="small"
                                sx={{ bgcolor: NODE_META[(selectedNode.data.kind as NodeKind) ?? 'agent']?.color + '22', alignSelf: 'flex-start' }}
                            />
                            <TextField
                                label="Label"
                                size="small"
                                fullWidth
                                value={(selectedNode.data.label as string) ?? ''}
                                onChange={(e) => updateNodeData('label', e.target.value)}
                            />

                            {selectedNode.data.kind === 'agent' && (
                                <FormControl fullWidth size="small">
                                    <InputLabel>Agent</InputLabel>
                                    <Select
                                        value={(selectedNode.data.agentId as string) ?? ''}
                                        label="Agent"
                                        onChange={(e) => updateNodeData('agentId', e.target.value)}
                                    >
                                        <MenuItem value=""><em>None</em></MenuItem>
                                        {agents.map(a => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
                                    </Select>
                                </FormControl>
                            )}

                            {selectedNode.data.kind === 'llm' && (
                                <>
                                    <FormControl fullWidth size="small">
                                        <InputLabel>Model</InputLabel>
                                        <Select
                                            value={(selectedNode.data.modelId as string) ?? ''}
                                            label="Model"
                                            onChange={(e) => updateNodeData('modelId', e.target.value)}
                                        >
                                            <MenuItem value=""><em>None</em></MenuItem>
                                            {models.map(m => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                    <TextField
                                        label="Prompt template"
                                        size="small"
                                        fullWidth
                                        multiline
                                        rows={3}
                                        value={(selectedNode.data.promptTemplate as string) ?? ''}
                                        onChange={(e) => updateNodeData('promptTemplate', e.target.value)}
                                        helperText="Use {{input}} for the upstream output"
                                    />
                                </>
                            )}

                            {selectedNode.data.kind === 'condition' && (
                                <TextField
                                    label="Condition expression"
                                    size="small"
                                    fullWidth
                                    multiline
                                    rows={2}
                                    value={(selectedNode.data.condition as string) ?? ''}
                                    onChange={(e) => updateNodeData('condition', e.target.value)}
                                    helperText="JS expression — true → left branch, false → right"
                                />
                            )}

                            {!['input', 'output', 'merge'].includes(selectedNode.data.kind as string) && (
                                <TextField
                                    label="System prompt / note"
                                    size="small"
                                    fullWidth
                                    multiline
                                    rows={2}
                                    value={(selectedNode.data.systemPrompt as string) ?? ''}
                                    onChange={(e) => updateNodeData('systemPrompt', e.target.value)}
                                />
                            )}

                            <Typography variant="caption" color="text.secondary">ID: {selectedNode.id}</Typography>
                            <Divider />
                            <Button
                                size="small" color="error" variant="outlined"
                                onClick={deleteSelectedNode}
                                disabled={['input', 'output'].includes(selectedNode.data.kind as string)}
                            >
                                Delete node
                            </Button>
                        </Paper>
                    )}

                    {/* Execution output panel */}
                    <Collapse in={execPanelOpen} orientation="horizontal">
                        <Paper elevation={0} sx={{
                            width: 320, borderLeft: 1, borderColor: 'divider',
                            display: 'flex', flexDirection: 'column', height: '100%',
                        }}>
                            <Box sx={{
                                p: 1.5, borderBottom: 1, borderColor: 'divider',
                                display: 'flex', alignItems: 'center', gap: 1,
                            }}>
                                <Typography variant="subtitle2" fontWeight={700} sx={{ flexGrow: 1 }}>
                                    Execution Output
                                </Typography>
                                {running && <CircularProgress size={16} />}
                                <Chip
                                    label={running ? 'running' : runError ? 'failed' : 'ready'}
                                    size="small"
                                    color={running ? 'info' : runError ? 'error' : 'default'}
                                />
                            </Box>
                            <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1 }}>
                                <TextField
                                    size="small"
                                    fullWidth
                                    placeholder="Initial input…"
                                    value={runInput}
                                    onChange={(e) => setRunInput(e.target.value)}
                                />
                                <Button size="small" variant="contained" onClick={runWorkflow}
                                    disabled={!editingId || running}>
                                    Run
                                </Button>
                            </Box>
                            {runError && (
                                <Alert severity="error" sx={{ m: 1 }}>{runError}</Alert>
                            )}
                            <Box sx={{
                                flexGrow: 1, overflowY: 'auto', p: 1.5,
                                fontFamily: 'monospace', fontSize: '0.8rem',
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                bgcolor: 'background.default',
                            }}>
                                {runOutput.length === 0 && !running && (
                                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                                        Run the workflow to see output…
                                    </Typography>
                                )}
                                {runOutput.join('')}
                                <div ref={outputEndRef} />
                            </Box>
                        </Paper>
                    </Collapse>
                </Box>
            </Box>

            <Snackbar
                open={!!snack}
                autoHideDuration={3000}
                onClose={() => setSnack(null)}
                message={snack}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            />
        </Box>
    );
}
