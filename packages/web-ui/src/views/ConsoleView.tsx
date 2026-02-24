import { useState, useRef, useEffect, useMemo } from 'react';
import { useClient } from '../ClientContext.js';
import {
    SERVICE_REGISTRY,
    getTopicDef,
    getActionDef,
    buildPayload,
    type ActionDef,
    type FieldDef,
} from '../serviceRegistry.js';
import {
    Box,
    Paper,
    Typography,
    TextField,
    Button,
    Select,
    MenuItem,
    IconButton,
    Chip,
    Switch,
    FormControlLabel,
    Tooltip,
    Divider,
    Collapse,
    Badge,
} from '@mui/material';
import {
    Play,
    Terminal as TerminalIcon,
    Trash2,
    Copy,
    ChevronDown,
    ChevronRight,
    RotateCcw,
    Clock,
    Zap,
    FileJson,
    FormInput,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogEntry {
    id: string;
    timestamp: string;
    type: 'request' | 'response' | 'error' | 'stream';
    content: string;
    topic?: string;
    action?: string;
    durationMs?: number;
}

interface HistoryEntry {
    id: string;
    topic: string;
    action: string;
    payload: Record<string, unknown>;
    isStream: boolean;
    timestamp: string;
    status: 'success' | 'error' | 'pending';
    durationMs?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ConsoleView() {
    const client = useClient();

    // ── Request Builder State ────────────────────────────────────────────
    const [selectedTopic, setSelectedTopic] = useState(SERVICE_REGISTRY[0]?.topic ?? 'health');
    const [selectedAction, setSelectedAction] = useState('');
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [rawJson, setRawJson] = useState('{}');
    const [inputMode, setInputMode] = useState<'form' | 'json'>('form');
    const [isStream, setIsStream] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);

    // ── Output State ────────────────────────────────────────────────────
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // ── Derived State ───────────────────────────────────────────────────
    const topicDef = useMemo(() => getTopicDef(selectedTopic), [selectedTopic]);
    const actionDef = useMemo(
        () => getActionDef(selectedTopic, selectedAction),
        [selectedTopic, selectedAction]
    );

    // Update action when topic changes
    useEffect(() => {
        if (topicDef && topicDef.actions.length > 0) {
            const first = topicDef.actions[0]!;
            setSelectedAction(first.action);
            setIsStream(first.isStream ?? false);
            resetFields(first);
        }
    }, [selectedTopic]); // eslint-disable-line react-hooks/exhaustive-deps

    // Update stream and reset fields when action changes
    useEffect(() => {
        if (actionDef) {
            setIsStream(actionDef.isStream ?? false);
            resetFields(actionDef);
        }
    }, [selectedAction]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    function resetFields(action: ActionDef) {
        const defaults: Record<string, string> = {};
        for (const f of action.fields) {
            if (f.default !== undefined) {
                defaults[f.name] =
                    typeof f.default === 'string'
                        ? f.default
                        : JSON.stringify(f.default);
            }
        }
        setFieldValues(defaults);
        setRawJson(JSON.stringify(defaults, null, 2));
    }

    function setFieldValue(name: string, value: string) {
        setFieldValues(prev => {
            const next = { ...prev, [name]: value };
            setRawJson(JSON.stringify(next, null, 2));
            return next;
        });
    }

    // ── Add log ─────────────────────────────────────────────────────────
    const addLog = (
        type: LogEntry['type'],
        content: unknown,
        extra?: Partial<LogEntry>
    ) => {
        setLogs(prev => [
            ...prev,
            {
                id: Date.now().toString() + Math.random(),
                timestamp: new Date().toISOString(),
                type,
                content:
                    typeof content === 'string'
                        ? content
                        : JSON.stringify(content, null, 2),
                ...extra,
            },
        ]);
    };

    // ── Execute ─────────────────────────────────────────────────────────
    const handleExecute = async () => {
        if (!client) {
            addLog('error', 'Client not connected.');
            return;
        }

        let payload: Record<string, unknown>;
        if (inputMode === 'json') {
            try {
                payload = JSON.parse(rawJson);
            } catch (e: any) {
                addLog('error', `Invalid JSON payload: ${e.message}`);
                return;
            }
        } else {
            payload = actionDef
                ? buildPayload(actionDef.fields, fieldValues)
                : {};
        }

        const startTime = Date.now();
        const historyId = startTime.toString() + Math.random();

        setHistory(prev => [
            {
                id: historyId,
                topic: selectedTopic,
                action: selectedAction,
                payload,
                isStream,
                timestamp: new Date().toISOString(),
                status: 'pending',
            },
            ...prev,
        ]);

        addLog('request', {
            mode: isStream ? 'STREAM' : 'RPC',
            topic: selectedTopic,
            action: selectedAction,
            payload,
        }, {
            topic: selectedTopic,
            action: selectedAction,
        });

        setIsExecuting(true);
        try {
            if (isStream) {
                const stream = client.requestStream(
                    selectedTopic,
                    selectedAction,
                    payload
                );
                for await (const chunk of stream) {
                    addLog('stream', chunk, {
                        topic: selectedTopic,
                        action: selectedAction,
                    });
                }
                const durationMs = Date.now() - startTime;
                addLog('response', '[Stream Completed]', { durationMs });
                updateHistory(historyId, 'success', durationMs);
            } else {
                const res = await client.request(
                    selectedTopic,
                    selectedAction,
                    payload
                );
                const durationMs = Date.now() - startTime;
                addLog('response', res, {
                    topic: selectedTopic,
                    action: selectedAction,
                    durationMs,
                });
                updateHistory(historyId, 'success', durationMs);
            }
        } catch (err: any) {
            const durationMs = Date.now() - startTime;
            addLog('error', err.message || JSON.stringify(err), { durationMs });
            updateHistory(historyId, 'error', durationMs);
        } finally {
            setIsExecuting(false);
        }
    };

    const updateHistory = (
        id: string,
        status: 'success' | 'error',
        durationMs: number
    ) => {
        setHistory(prev =>
            prev.map(h => (h.id === id ? { ...h, status, durationMs } : h))
        );
    };

    const replayHistory = (entry: HistoryEntry) => {
        setSelectedTopic(entry.topic);
        setTimeout(() => {
            setSelectedAction(entry.action);
            setIsStream(entry.isStream);
            const values: Record<string, string> = {};
            for (const [k, v] of Object.entries(entry.payload)) {
                values[k] = typeof v === 'string' ? v : JSON.stringify(v);
            }
            setFieldValues(values);
            setRawJson(JSON.stringify(entry.payload, null, 2));
        }, 50);
    };

    // ── Render ───────────────────────────────────────────────────────────

    return (
        <Box sx={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, p: { xs: 1, sm: 2 } }}>
            {/* Left Panel: Request Builder */}
            <Paper
                elevation={0}
                sx={{
                    width: { xs: '100%', md: 400 },
                    minHeight: { xs: 'auto', md: 'unset' },
                    maxHeight: { xs: '50vh', md: 'unset' },
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 2,
                    overflow: 'hidden',
                }}
            >
                {/* Header */}
                <Box
                    sx={{
                        p: 2,
                        borderBottom: 1,
                        borderColor: 'divider',
                        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                    }}
                >
                    <Zap size={20} />
                    <Typography variant="h6" fontWeight="bold">
                        Request Builder
                    </Typography>
                </Box>

                <Box
                    sx={{
                        p: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        overflowY: 'auto',
                        flexGrow: 1,
                    }}
                >
                    {/* Topic Selector */}
                    <Box>
                        <Typography
                            variant="caption"
                            fontWeight="bold"
                            color="text.secondary"
                            sx={{ textTransform: 'uppercase', letterSpacing: 1 }}
                        >
                            Service / Topic
                        </Typography>
                        <Select
                            fullWidth
                            size="small"
                            value={selectedTopic}
                            onChange={e => setSelectedTopic(e.target.value)}
                            sx={{ mt: 0.5 }}
                            renderValue={val => {
                                const td = getTopicDef(val);
                                return (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box
                                            sx={{
                                                width: 10,
                                                height: 10,
                                                borderRadius: '50%',
                                                bgcolor: td?.color ?? '#888',
                                            }}
                                        />
                                        <Typography fontWeight="bold">
                                            {td?.label ?? val}
                                        </Typography>
                                    </Box>
                                );
                            }}
                        >
                            {SERVICE_REGISTRY.map(t => (
                                <MenuItem key={t.topic} value={t.topic}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <Box
                                            sx={{
                                                width: 10,
                                                height: 10,
                                                borderRadius: '50%',
                                                bgcolor: t.color,
                                            }}
                                        />
                                        <Box>
                                            <Typography fontWeight="bold">{t.label}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {t.description}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </MenuItem>
                            ))}
                        </Select>
                    </Box>

                    {/* Action Selector */}
                    <Box>
                        <Typography
                            variant="caption"
                            fontWeight="bold"
                            color="text.secondary"
                            sx={{ textTransform: 'uppercase', letterSpacing: 1 }}
                        >
                            Action
                        </Typography>
                        <Select
                            fullWidth
                            size="small"
                            value={selectedAction}
                            onChange={e => {
                                setSelectedAction(e.target.value);
                            }}
                            sx={{ mt: 0.5 }}
                        >
                            {(topicDef?.actions ?? []).map(a => (
                                <MenuItem key={a.action} value={a.action}>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            width: '100%',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <Box>
                                            <Typography
                                                fontWeight="bold"
                                                fontFamily="monospace"
                                                fontSize="0.85rem"
                                            >
                                                {a.action}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {a.description}
                                            </Typography>
                                        </Box>
                                        {a.isStream && (
                                            <Chip
                                                label="STREAM"
                                                size="small"
                                                color="warning"
                                                sx={{ ml: 1, fontWeight: 'bold', fontSize: '0.65rem' }}
                                            />
                                        )}
                                    </Box>
                                </MenuItem>
                            ))}
                        </Select>
                    </Box>

                    <Divider />

                    {/* Input Mode Toggle */}
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                        <Button
                            variant={inputMode === 'form' ? 'contained' : 'outlined'}
                            size="small"
                            startIcon={<FormInput size={14} />}
                            onClick={() => setInputMode('form')}
                            sx={{ flex: 1, fontSize: '0.75rem' }}
                        >
                            Form Fields
                        </Button>
                        <Button
                            variant={inputMode === 'json' ? 'contained' : 'outlined'}
                            size="small"
                            startIcon={<FileJson size={14} />}
                            onClick={() => {
                                // Sync form values → raw json
                                if (actionDef) {
                                    const payload = buildPayload(actionDef.fields, fieldValues);
                                    setRawJson(JSON.stringify(payload, null, 2));
                                }
                                setInputMode('json');
                            }}
                            sx={{ flex: 1, fontSize: '0.75rem' }}
                        >
                            Raw JSON
                        </Button>
                    </Box>

                    {/* Payload Form or JSON Editor */}
                    {inputMode === 'form' ? (
                        <FieldsForm
                            fields={actionDef?.fields ?? []}
                            values={fieldValues}
                            onChange={setFieldValue}
                        />
                    ) : (
                        <TextField
                            fullWidth
                            multiline
                            rows={10}
                            variant="outlined"
                            value={rawJson}
                            onChange={e => setRawJson(e.target.value)}
                            sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                        />
                    )}

                    {/* Stream toggle */}
                    <FormControlLabel
                        control={
                            <Switch
                                checked={isStream}
                                onChange={e => setIsStream(e.target.checked)}
                                size="small"
                            />
                        }
                        label={
                            <Typography variant="body2" fontWeight="bold">
                                Stream Mode
                            </Typography>
                        }
                    />

                    {/* Execute */}
                    <Button
                        variant="contained"
                        color="primary"
                        size="large"
                        startIcon={<Play size={20} />}
                        onClick={handleExecute}
                        disabled={!client || isExecuting}
                        sx={{ py: 1.5 }}
                    >
                        {isExecuting ? 'Executing...' : 'Execute Request'}
                    </Button>
                </Box>
            </Paper>

            {/* Right Panel: Output + History */}
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minHeight: { xs: '50vh', md: 0 } }}>
                {/* Console Output */}
                <Paper
                    elevation={0}
                    sx={{
                        flexGrow: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 2,
                        overflow: 'hidden',
                        bgcolor: '#0a0a0a',
                    }}
                >
                    <Box
                        sx={{
                            p: 1.5,
                            borderBottom: '1px solid #222',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            bgcolor: '#111',
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#fff' }}>
                            <TerminalIcon size={18} />
                            <Typography variant="subtitle2" fontFamily="monospace">
                                Console Output
                            </Typography>
                            <Badge
                                badgeContent={logs.length}
                                color="primary"
                                max={999}
                                sx={{ ml: 1 }}
                            >
                                <span />
                            </Badge>
                        </Box>
                        <IconButton
                            size="small"
                            onClick={() => setLogs([])}
                            sx={{ color: '#999' }}
                        >
                            <Trash2 size={16} />
                        </IconButton>
                    </Box>

                    <Box
                        sx={{
                            flexGrow: 1,
                            overflowY: 'auto',
                            p: 2,
                            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                            fontSize: '0.8rem',
                        }}
                    >
                        {logs.length === 0 ? (
                            <Typography color="#555" fontStyle="italic">
                                Select a service and action, then click Execute...
                            </Typography>
                        ) : (
                            logs.map(log => (
                                <Box key={log.id} sx={{ mb: 2 }}>
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            mb: 0.5,
                                        }}
                                    >
                                        <Typography
                                            variant="caption"
                                            sx={{ color: '#555' }}
                                        >
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </Typography>
                                        <Chip
                                            label={log.type.toUpperCase()}
                                            size="small"
                                            sx={{
                                                height: 18,
                                                fontSize: '0.65rem',
                                                fontWeight: 'bold',
                                                bgcolor:
                                                    log.type === 'error'
                                                        ? '#dc262620'
                                                        : log.type === 'request'
                                                        ? '#3b82f620'
                                                        : log.type === 'stream'
                                                        ? '#10b98120'
                                                        : '#f8fafc15',
                                                color:
                                                    log.type === 'error'
                                                        ? '#ef4444'
                                                        : log.type === 'request'
                                                        ? '#60a5fa'
                                                        : log.type === 'stream'
                                                        ? '#34d399'
                                                        : '#f8fafc',
                                                border: '1px solid',
                                                borderColor:
                                                    log.type === 'error'
                                                        ? '#ef444440'
                                                        : log.type === 'request'
                                                        ? '#60a5fa40'
                                                        : log.type === 'stream'
                                                        ? '#34d39940'
                                                        : '#f8fafc20',
                                            }}
                                        />
                                        {log.topic && (
                                            <Typography
                                                variant="caption"
                                                sx={{
                                                    color:
                                                        getTopicDef(log.topic)?.color ?? '#888',
                                                    fontWeight: 'bold',
                                                }}
                                            >
                                                {log.topic}.{log.action}
                                            </Typography>
                                        )}
                                        {log.durationMs !== undefined && (
                                            <Typography
                                                variant="caption"
                                                sx={{ color: '#888', ml: 'auto' }}
                                            >
                                                {log.durationMs}ms
                                            </Typography>
                                        )}
                                        <IconButton
                                            size="small"
                                            onClick={() =>
                                                navigator.clipboard.writeText(log.content)
                                            }
                                            sx={{ color: '#555', ml: 'auto', p: 0.25 }}
                                        >
                                            <Copy size={12} />
                                        </IconButton>
                                    </Box>
                                    <Box
                                        component="pre"
                                        sx={{
                                            m: 0,
                                            p: 1.5,
                                            bgcolor: '#0f0f0f',
                                            color:
                                                log.type === 'error' ? '#fca5a5' : '#e2e8f0',
                                            borderRadius: 1,
                                            whiteSpace: 'pre-wrap',
                                            wordBreak: 'break-word',
                                            border: '1px solid #1a1a1a',
                                            fontSize: '0.8rem',
                                            lineHeight: 1.5,
                                        }}
                                    >
                                        {log.content}
                                    </Box>
                                </Box>
                            ))
                        )}
                        <div ref={logsEndRef} />
                    </Box>
                </Paper>

                {/* History Drawer */}
                {history.length > 0 && (
                    <Paper
                        elevation={0}
                        sx={{
                            maxHeight: 200,
                            overflowY: 'auto',
                            borderRadius: 2,
                        }}
                    >
                        <Box
                            sx={{
                                p: 1.5,
                                borderBottom: 1,
                                borderColor: 'divider',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                            }}
                        >
                            <Clock size={16} />
                            <Typography variant="subtitle2" fontWeight="bold">
                                History
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                ({history.length})
                            </Typography>
                        </Box>
                        {history.map(h => (
                            <Box key={h.id}>
                                <Box
                                    sx={{
                                        px: 2,
                                        py: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        cursor: 'pointer',
                                        '&:hover': { bgcolor: 'action.hover' },
                                    }}
                                    onClick={() =>
                                        setExpandedHistory(
                                            expandedHistory === h.id ? null : h.id
                                        )
                                    }
                                >
                                    {expandedHistory === h.id ? (
                                        <ChevronDown size={14} />
                                    ) : (
                                        <ChevronRight size={14} />
                                    )}
                                    <Chip
                                        label={h.status}
                                        size="small"
                                        color={
                                            h.status === 'success'
                                                ? 'success'
                                                : h.status === 'error'
                                                ? 'error'
                                                : 'default'
                                        }
                                        sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'bold' }}
                                    />
                                    <Typography
                                        variant="body2"
                                        fontFamily="monospace"
                                        fontWeight="bold"
                                    >
                                        {h.topic}.{h.action}
                                    </Typography>
                                    {h.durationMs !== undefined && (
                                        <Typography variant="caption" color="text.secondary">
                                            {h.durationMs}ms
                                        </Typography>
                                    )}
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ ml: 'auto' }}
                                    >
                                        {new Date(h.timestamp).toLocaleTimeString()}
                                    </Typography>
                                    <Tooltip title="Re-execute">
                                        <IconButton
                                            size="small"
                                            onClick={e => {
                                                e.stopPropagation();
                                                replayHistory(h);
                                            }}
                                        >
                                            <RotateCcw size={14} />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                                <Collapse in={expandedHistory === h.id}>
                                    <Box
                                        component="pre"
                                        sx={{
                                            mx: 2,
                                            mb: 1,
                                            p: 1,
                                            bgcolor: 'action.hover',
                                            borderRadius: 1,
                                            fontSize: '0.75rem',
                                            fontFamily: 'monospace',
                                            whiteSpace: 'pre-wrap',
                                        }}
                                    >
                                        {JSON.stringify(h.payload, null, 2)}
                                    </Box>
                                </Collapse>
                            </Box>
                        ))}
                    </Paper>
                )}
            </Box>
        </Box>
    );
}

// ─── Fields Form Sub-component ───────────────────────────────────────────────

function FieldsForm({
    fields,
    values,
    onChange,
}: {
    fields: FieldDef[];
    values: Record<string, string>;
    onChange: (name: string, value: string) => void;
}) {
    if (fields.length === 0) {
        return (
            <Box
                sx={{
                    p: 3,
                    textAlign: 'center',
                    border: '2px dashed',
                    borderColor: 'divider',
                    borderRadius: 2,
                }}
            >
                <Typography variant="body2" color="text.secondary" fontStyle="italic">
                    No payload fields required for this action
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {fields.map(field => (
                <Box key={field.name}>
                    <Typography
                        variant="caption"
                        fontWeight="bold"
                        color="text.secondary"
                    >
                        {field.name}
                        {field.required && (
                            <Typography
                                component="span"
                                sx={{ color: 'error.main', ml: 0.5 }}
                            >
                                *
                            </Typography>
                        )}
                    </Typography>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mb: 0.5, fontSize: '0.7rem' }}
                    >
                        {field.description}
                    </Typography>

                    {field.type === 'boolean' ? (
                        <FormControlLabel
                            control={
                                <Switch
                                    size="small"
                                    checked={values[field.name] === 'true'}
                                    onChange={e =>
                                        onChange(
                                            field.name,
                                            e.target.checked ? 'true' : 'false'
                                        )
                                    }
                                />
                            }
                            label={
                                <Typography variant="body2">
                                    {values[field.name] === 'true' ? 'true' : 'false'}
                                </Typography>
                            }
                        />
                    ) : field.type === 'select' ? (
                        <Select
                            fullWidth
                            size="small"
                            value={values[field.name] ?? field.default ?? ''}
                            onChange={e => onChange(field.name, e.target.value as string)}
                        >
                            {(field.options ?? []).map(opt => (
                                <MenuItem key={opt} value={opt}>
                                    {opt}
                                </MenuItem>
                            ))}
                        </Select>
                    ) : field.type === 'json' ? (
                        <TextField
                            fullWidth
                            size="small"
                            multiline
                            rows={3}
                            variant="outlined"
                            value={values[field.name] ?? ''}
                            onChange={e => onChange(field.name, e.target.value)}
                            placeholder={`{ "key": "value" }`}
                            sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                        />
                    ) : (
                        <TextField
                            fullWidth
                            size="small"
                            variant="outlined"
                            type={field.type === 'number' ? 'number' : 'text'}
                            value={values[field.name] ?? ''}
                            onChange={e => onChange(field.name, e.target.value)}
                            placeholder={
                                field.type === 'string[]'
                                    ? 'val1, val2, val3'
                                    : field.type === 'number'
                                    ? '0'
                                    : ''
                            }
                            sx={{ fontFamily: 'monospace' }}
                        />
                    )}
                </Box>
            ))}
        </Box>
    );
}
