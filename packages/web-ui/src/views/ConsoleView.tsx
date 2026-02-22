import { useState, useRef, useEffect } from 'react';

import type { OrchestratorClient } from '@orch/client';
import { Box, Paper, Typography, TextField, Button, Select, MenuItem, IconButton } from '@mui/material';
import { Play, Terminal as TerminalIcon, Trash2 } from 'lucide-react';

interface ConsoleProps {
    client: OrchestratorClient | null;
}

interface LogEntry {
    id: string;
    timestamp: string;
    type: 'request' | 'response' | 'error' | 'stream';
    content: string;
}

const NAMESPACES = ['process', 'container', 'vault', 'db', 'agent'];

export default function ConsoleView({ client }: ConsoleProps) {
    const [namespace, setNamespace] = useState('process');
    const [action, setAction] = useState('list');
    const [payloadStr, setPayloadStr] = useState('{}');
    const [isStream, setIsStream] = useState(false);

    const [logs, setLogs] = useState<LogEntry[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [logs]);

    const addLog = (type: LogEntry['type'], content: any) => {
        setLogs(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            timestamp: new Date().toISOString(),
            type,
            content: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
        }]);
    };

    const handleExecute = async () => {
        if (!client) {
            addLog('error', 'Client not connected.');
            return;
        }

        let parsedPayload = {};
        try {
            parsedPayload = JSON.parse(payloadStr);
        } catch (e: any) {
            addLog('error', `Invalid JSON payload: ${e.message}`);
            return;
        }

        addLog('request', `[${isStream ? 'STREAM' : 'RPC'}] ${namespace}.${action} \n${JSON.stringify(parsedPayload, null, 2)}`);

        try {
            if (isStream) {
                const stream = client.requestStream(namespace, action, parsedPayload);
                for await (const chunk of stream) {
                    addLog('stream', chunk);
                }
                addLog('response', '[Stream Completed]');
            } else {
                const res = await client.request(namespace, action, parsedPayload);
                addLog('response', res);
            }
        } catch (err: any) {
            addLog('error', err.message || JSON.stringify(err));
        }
    };

    return (
        <Box sx={{ height: 'calc(100vh - 48px)', display: 'flex', gap: 2, p: 2 }}>
            {/* Left Panel: Request Builder */}
            <Paper elevation={0} sx={{ width: 350, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'primary.main', color: 'primary.contrastText' }}>
                    <Typography variant="h6" fontWeight="bold">Request Builder</Typography>
                </Box>

                <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
                    <Box>
                        <Typography variant="caption" fontWeight="bold" color="text.secondary">NAMESPACE</Typography>
                        <Select
                            fullWidth
                            size="small"
                            value={namespace}
                            onChange={(e) => setNamespace(e.target.value)}
                            sx={{ mt: 0.5, fontWeight: 'bold' }}
                        >
                            {NAMESPACES.map(ns => (
                                <MenuItem key={ns} value={ns}>{ns}</MenuItem>
                            ))}
                        </Select>
                    </Box>

                    <Box>
                        <Typography variant="caption" fontWeight="bold" color="text.secondary">ACTION</Typography>
                        <TextField
                            fullWidth
                            size="small"
                            variant="outlined"
                            value={action}
                            onChange={(e) => setAction(e.target.value)}
                            sx={{ mt: 0.5 }}
                        />
                    </Box>

                    <Box>
                        <Typography variant="caption" fontWeight="bold" color="text.secondary">PAYLOAD (JSON)</Typography>
                        <TextField
                            fullWidth
                            multiline
                            rows={8}
                            variant="outlined"
                            value={payloadStr}
                            onChange={(e) => setPayloadStr(e.target.value)}
                            sx={{ mt: 0.5, fontFamily: 'monospace' }}
                        />
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <Button
                            variant={isStream ? 'contained' : 'outlined'}
                            color="secondary"
                            onClick={() => setIsStream(true)}
                            sx={{ flex: 1 }}
                        >
                            Stream
                        </Button>
                        <Button
                            variant={!isStream ? 'contained' : 'outlined'}
                            color="primary"
                            onClick={() => setIsStream(false)}
                            sx={{ flex: 1 }}
                        >
                            RPC Check
                        </Button>
                    </Box>

                    <Button
                        variant="contained"
                        color="primary"
                        size="large"
                        startIcon={<Play size={20} />}
                        onClick={handleExecute}
                        disabled={!client}
                        sx={{ mt: 'auto', py: 1.5 }}
                    >
                        Execute Request
                    </Button>
                </Box>
            </Paper>

            {/* Right Panel: Output Terminal */}
            <Paper elevation={0} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden', bgcolor: '#000' }}>
                <Box sx={{ p: 1.5, borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#111' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#fff' }}>
                        <TerminalIcon size={18} />
                        <Typography variant="subtitle2" fontFamily="monospace">Console Output</Typography>
                    </Box>
                    <IconButton size="small" onClick={() => setLogs([])} sx={{ color: '#fff' }}>
                        <Trash2 size={16} />
                    </IconButton>
                </Box>

                <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2, fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    {logs.length === 0 ? (
                        <Typography color="#666" fontStyle="italic">Awaiting execution...</Typography>
                    ) : (
                        logs.map(log => (
                            <Box key={log.id} sx={{ mb: 2 }}>
                                <Typography variant="caption" sx={{ color: '#666', mr: 2 }}>
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                </Typography>
                                <Typography
                                    component="span"
                                    sx={{
                                        color: log.type === 'error' ? '#ef4444' :
                                               log.type === 'request' ? '#3b82f6' :
                                               log.type === 'stream' ? '#10b981' : '#f8fafc',
                                        fontWeight: 'bold'
                                    }}
                                >
                                    [{log.type.toUpperCase()}]
                                </Typography>
                                <Box
                                    component="pre"
                                    sx={{
                                        m: 0, mt: 0.5, p: 1,
                                        bgcolor: '#111',
                                        color: log.type === 'error' ? '#fca5a5' : '#e2e8f0',
                                        borderRadius: 1,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        border: '1px solid #222'
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
        </Box>
    );
}
