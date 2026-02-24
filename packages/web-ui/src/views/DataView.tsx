import { useState, useMemo, useCallback, useEffect } from 'react';
import { useClient } from '../ClientContext.js';
import {
    Box,
    Paper,
    Typography,
    TextField,
    Button,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Tooltip,
    CircularProgress,
    Alert,
    Divider,
    Pagination,
    Tabs,
    Tab,
    Select,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControlLabel,
    Switch,
    Drawer,
    Fab,
    useMediaQuery,
} from '@mui/material';
import {
    Database,
    TableIcon,
    Play,
    RefreshCcw,
    Info,
    Search,
    X,
    Hash,
    Type,
    ToggleLeft,
    Key,
    Layers,
    Shield,
    Plus,
    Trash2,
    Plug,
    TestTube,
    PanelLeftOpen,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TableInfo { name: string; type: 'table' | 'view'; }

interface SchemaColumn {
    cid: number; name: string; type: string;
    notnull: number; dflt_value: string | null; pk: number;
}

interface ExternalDb {
    id: string; owner: string; label: string; dbType: string;
    host?: string; port?: number; databaseName?: string;
    ssl?: boolean; createdAt: string;
}

type ConnectionMode = 'workspace' | 'root' | 'external';

// ─── Sidebar Content (shared between Paper & Drawer) ────────────────────────

function SidebarContent({
    mode, setMode, workspaceId, setWorkspaceId, dbId, setDbId,
    connected, connError, isAdmin, loading, connect, disconnect,
    extDbs, selectedExtDb, setSelectedExtDb, loadExtDbs, setShowRegisterDialog,
    testExtDb, removeExtDb, tables, selectedTable, selectTable,
    tableFilter, setTableFilter, onRefresh,
}: {
    mode: ConnectionMode; setMode: (m: ConnectionMode) => void;
    workspaceId: string; setWorkspaceId: (v: string) => void;
    dbId: string; setDbId: (v: string) => void;
    connected: boolean; connError: string; isAdmin: boolean;
    loading: boolean; connect: () => void; disconnect: () => void;
    extDbs: ExternalDb[]; selectedExtDb: ExternalDb | null;
    setSelectedExtDb: (db: ExternalDb) => void; loadExtDbs: () => void;
    setShowRegisterDialog: (v: boolean) => void;
    testExtDb: (id: string) => void; removeExtDb: (id: string) => void;
    tables: TableInfo[]; selectedTable: string; selectTable: (t: string) => void;
    tableFilter: string; setTableFilter: (v: string) => void;
    onRefresh: () => void;
}) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Connection Panel */}
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Database size={18} />
                    <Typography variant="subtitle2" fontWeight="bold">Connection</Typography>
                </Box>

                {!connected && (
                    <>
                        <Tabs
                            value={mode}
                            onChange={(_, v) => setMode(v)}
                            variant="fullWidth"
                            sx={{ mb: 2, minHeight: 32, '& .MuiTab-root': { minHeight: 32, py: 0.5, fontSize: '0.7rem' } }}
                        >
                            <Tab label="Workspace" value="workspace" />
                            {isAdmin && <Tab label="Root DB" value="root" />}
                            <Tab label="External" value="external" />
                        </Tabs>

                        {mode === 'workspace' && (
                            <>
                                <TextField size="small" fullWidth label="Workspace ID" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} sx={{ mb: 1 }} />
                                <TextField size="small" fullWidth label="Database ID" value={dbId} onChange={e => setDbId(e.target.value)} sx={{ mb: 1 }} />
                            </>
                        )}

                        {mode === 'root' && (
                            <Alert severity="warning" sx={{ mb: 1, fontSize: '0.75rem' }}>
                                <Shield size={14} /> Admin-only root database access
                            </Alert>
                        )}

                        {mode === 'external' && (
                            <>
                                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<Plus size={14} />} onClick={() => setShowRegisterDialog(true)} fullWidth>
                                        Register
                                    </Button>
                                    <Tooltip title="Refresh list">
                                        <IconButton size="small" onClick={loadExtDbs}><RefreshCcw size={14} /></IconButton>
                                    </Tooltip>
                                </Box>
                                {extDbs.length > 0 ? (
                                    <List dense sx={{ maxHeight: 180, overflow: 'auto' }}>
                                        {extDbs.map(db => (
                                            <ListItem
                                                key={db.id}
                                                disablePadding
                                                secondaryAction={
                                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                                        <Tooltip title="Test"><IconButton size="small" onClick={() => testExtDb(db.id)}><TestTube size={12} /></IconButton></Tooltip>
                                                        <Tooltip title="Remove"><IconButton size="small" onClick={() => removeExtDb(db.id)}><Trash2 size={12} /></IconButton></Tooltip>
                                                    </Box>
                                                }
                                            >
                                                <ListItemButton selected={selectedExtDb?.id === db.id} onClick={() => setSelectedExtDb(db)} sx={{ borderRadius: 1 }}>
                                                    <ListItemIcon sx={{ minWidth: 28 }}><Plug size={14} /></ListItemIcon>
                                                    <ListItemText
                                                        primary={db.label}
                                                        secondary={`${db.dbType} ${db.host ? `• ${db.host}` : ''}`}
                                                        primaryTypographyProps={{ fontSize: '0.8rem', fontWeight: 'bold' }}
                                                        secondaryTypographyProps={{ fontSize: '0.65rem' }}
                                                    />
                                                </ListItemButton>
                                            </ListItem>
                                        ))}
                                    </List>
                                ) : (
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', py: 1 }}>
                                        No external databases
                                    </Typography>
                                )}
                            </>
                        )}

                        <Button
                            fullWidth variant="contained" size="small" onClick={connect}
                            disabled={loading || (mode === 'workspace' && (!workspaceId || !dbId)) || (mode === 'external' && !selectedExtDb)}
                            startIcon={loading ? <CircularProgress size={14} /> : <Play size={14} />}
                            sx={{ mt: 1 }}
                        >
                            Connect
                        </Button>
                    </>
                )}

                {connected && (
                    <Box>
                        <Chip
                            label={mode === 'root' ? 'Root DB' : mode === 'external' ? selectedExtDb?.label : `${workspaceId}:${dbId}`}
                            color="success" size="small"
                            sx={{ fontWeight: 'bold', fontSize: '0.7rem', mb: 1, width: '100%' }}
                        />
                        <Button fullWidth variant="outlined" size="small" color="error" onClick={disconnect}>
                            Disconnect
                        </Button>
                    </Box>
                )}

                {connError && <Alert severity="error" sx={{ mt: 1, fontSize: '0.7rem' }}>{connError}</Alert>}
            </Box>

            {/* Table List */}
            {connected && (
                <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
                    <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TextField
                            size="small" fullWidth placeholder="Filter tables…"
                            value={tableFilter} onChange={e => setTableFilter(e.target.value)}
                            InputProps={{ startAdornment: <Search size={14} style={{ marginRight: 6 }} /> }}
                            sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' } }}
                        />
                        <Tooltip title="Refresh tables">
                            <IconButton size="small" onClick={onRefresh}><RefreshCcw size={14} /></IconButton>
                        </Tooltip>
                    </Box>
                    <Divider />
                    <List dense sx={{ py: 0 }}>
                        {tables.map(t => (
                            <ListItemButton key={t.name} selected={selectedTable === t.name} onClick={() => selectTable(t.name)} sx={{ py: 0.5 }}>
                                <ListItemIcon sx={{ minWidth: 28 }}>
                                    {t.type === 'view' ? <Layers size={14} /> : <TableIcon size={14} />}
                                </ListItemIcon>
                                <ListItemText primary={t.name} primaryTypographyProps={{ fontSize: '0.8rem', fontFamily: 'monospace' }} />
                            </ListItemButton>
                        ))}
                    </List>
                </Box>
            )}
        </Box>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DataView() {
    const client = useClient();
    const isMobile = useMediaQuery('(max-width: 768px)');
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

    // Connection state
    const [mode, setMode] = useState<ConnectionMode>('workspace');
    const [workspaceId, setWorkspaceId] = useState('');
    const [dbId, setDbId] = useState('');
    const [connected, setConnected] = useState(false);
    const [connError, setConnError] = useState('');
    const [isAdmin, setIsAdmin] = useState(false);

    // Table browsing
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [selectedTable, setSelectedTable] = useState('');
    const [tableFilter, setTableFilter] = useState('');
    const [tableData, setTableData] = useState<Record<string, unknown>[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [rowCount, setRowCount] = useState(0);
    const [page, setPage] = useState(1);
    const [sortCol, setSortCol] = useState('');
    const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('ASC');
    const [loading, setLoading] = useState(false);
    const [schemaOpen, setSchemaOpen] = useState(false);
    const [schemaColumns, setSchemaColumns] = useState<SchemaColumn[]>([]);

    // SQL editor
    const [tabIndex, setTabIndex] = useState(0);
    const [sql, setSql] = useState('');
    const [queryResult, setQueryResult] = useState<Record<string, unknown>[] | null>(null);
    const [queryCols, setQueryCols] = useState<string[]>([]);
    const [queryError, setQueryError] = useState('');

    // External DBs
    const [extDbs, setExtDbs] = useState<ExternalDb[]>([]);
    const [selectedExtDb, setSelectedExtDb] = useState<ExternalDb | null>(null);
    const [showRegisterDialog, setShowRegisterDialog] = useState(false);
    const [regForm, setRegForm] = useState({ label: '', dbType: 'postgres' as string, host: '', port: '', databaseName: '', ssl: false, username: '', password: '', filePath: '' });

    const ROWS_PER_PAGE = 50;

    useEffect(() => {
        if (!client) return;
        client.request('session', 'info').then((res: any) => {
            setIsAdmin(res?.roles?.includes('admin') ?? false);
        }).catch(() => {});
    }, [client]);

    const loadExtDbs = useCallback(async () => {
        if (!client) return;
        try {
            const res = await client.request<{ databases: ExternalDb[] }>('db', 'db.ext.list');
            setExtDbs(res.databases ?? []);
        } catch { /* ignore */ }
    }, [client]);

    useEffect(() => { loadExtDbs(); }, [loadExtDbs]);

    const executeQuery = useCallback(async (querySql: string, params: unknown[] = []) => {
        if (!client) return null;
        if (mode === 'root') {
            return await client.request('db', 'db.root_query', { sql: querySql, params });
        } else if (mode === 'external' && selectedExtDb) {
            return await client.request('db', 'db.ext.query', { id: selectedExtDb.id, sql: querySql, params });
        } else {
            return await client.request('db', 'db.query', { workspaceId, dbId, sql: querySql, params });
        }
    }, [client, mode, workspaceId, dbId, selectedExtDb]);

    const connect = useCallback(async () => {
        setConnError('');
        setLoading(true);
        try {
            let masterQuery = "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name";
            if (mode === 'external' && selectedExtDb) {
                if (selectedExtDb.dbType === 'postgres') {
                    masterQuery = "SELECT table_name as name, table_type as type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_type, table_name";
                } else if (selectedExtDb.dbType === 'mysql') {
                    masterQuery = "SELECT table_name as name, table_type as type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_type, table_name";
                }
            }
            const result = await executeQuery(masterQuery);
            const rows = result?.rows ?? [];
            setTables(rows.map((r: any) => ({
                name: r.name ?? r.table_name ?? r.TABLE_NAME,
                type: (r.type ?? r.table_type ?? 'table').toLowerCase().includes('view') ? 'view' as const : 'table' as const,
            })));
            setConnected(true);
            setSelectedTable('');
            setTableData([]);
            setColumns([]);
        } catch (err: any) {
            setConnError(err?.message ?? 'Connection failed');
        } finally {
            setLoading(false);
        }
    }, [executeQuery, mode, selectedExtDb]);

    const disconnect = () => {
        setConnected(false); setTables([]); setSelectedTable('');
        setTableData([]); setColumns([]); setSchemaOpen(false);
        setQueryResult(null); setSelectedExtDb(null);
    };

    const loadTableData = useCallback(async (table: string, pageNum = 1, orderBy?: string, dir?: 'ASC' | 'DESC') => {
        setLoading(true);
        try {
            const offset = (pageNum - 1) * ROWS_PER_PAGE;
            const order = orderBy ? ` ORDER BY "${orderBy}" ${dir ?? 'ASC'}` : '';
            const result = await executeQuery(`SELECT * FROM "${table}"${order} LIMIT ${ROWS_PER_PAGE} OFFSET ${offset}`);
            const rows = result?.rows ?? [];
            setTableData(rows);
            setColumns(rows.length > 0 ? Object.keys(rows[0]) : []);
            const countResult = await executeQuery(`SELECT COUNT(*) as cnt FROM "${table}"`);
            setRowCount(countResult?.rows?.[0]?.cnt ?? 0);
        } catch (err: any) {
            setConnError(err?.message ?? 'Query failed');
        } finally {
            setLoading(false);
        }
    }, [executeQuery]);

    const selectTable = (table: string) => {
        setSelectedTable(table); setPage(1); setSortCol(''); setSortDir('ASC');
        loadTableData(table, 1);
    };

    const handleSort = (col: string) => {
        const newDir = sortCol === col && sortDir === 'ASC' ? 'DESC' : 'ASC';
        setSortCol(col); setSortDir(newDir);
        loadTableData(selectedTable, page, col, newDir);
    };

    const handlePageChange = (_: unknown, newPage: number) => {
        setPage(newPage);
        loadTableData(selectedTable, newPage, sortCol || undefined, sortDir);
    };

    const loadSchema = async (table: string) => {
        try {
            let result;
            if (mode === 'external' && selectedExtDb?.dbType === 'postgres') {
                result = await executeQuery(`SELECT ordinal_position as cid, column_name as name, data_type as type, CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END as notnull, column_default as dflt_value, 0 as pk FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`);
            } else if (mode === 'external' && selectedExtDb?.dbType === 'mysql') {
                result = await executeQuery(`SELECT ordinal_position as cid, column_name as name, data_type as type, CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END as notnull, column_default as dflt_value, CASE WHEN column_key='PRI' THEN 1 ELSE 0 END as pk FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position`);
            } else {
                result = await executeQuery(`PRAGMA table_info("${table}")`);
            }
            setSchemaColumns(result?.rows ?? []);
            setSchemaOpen(true);
        } catch { /* ignore */ }
    };

    const runSql = async () => {
        setQueryError(''); setQueryResult(null); setLoading(true);
        try {
            const result = await executeQuery(sql);
            const rows = result?.rows ?? [];
            setQueryResult(rows);
            setQueryCols(rows.length > 0 ? Object.keys(rows[0]) : []);
        } catch (err: any) {
            setQueryError(err?.message ?? 'Query failed');
        } finally {
            setLoading(false);
        }
    };

    const registerExtDb = async () => {
        if (!client) return;
        try {
            await client.request('db', 'db.ext.register', {
                label: regForm.label, dbType: regForm.dbType,
                host: regForm.host || undefined, port: regForm.port ? Number(regForm.port) : undefined,
                databaseName: regForm.databaseName || undefined, ssl: regForm.ssl,
                username: regForm.username || undefined, password: regForm.password || undefined,
                filePath: regForm.filePath || undefined,
            });
            setShowRegisterDialog(false);
            setRegForm({ label: '', dbType: 'postgres', host: '', port: '', databaseName: '', ssl: false, username: '', password: '', filePath: '' });
            loadExtDbs();
        } catch (err: any) {
            setConnError(err?.message ?? 'Registration failed');
        }
    };

    const removeExtDb = async (id: string) => {
        if (!client) return;
        try {
            await client.request('db', 'db.ext.remove', { id });
            loadExtDbs();
            if (selectedExtDb?.id === id) disconnect();
        } catch (err: any) { setConnError(err?.message ?? 'Removal failed'); }
    };

    const testExtDb = async (id: string) => {
        if (!client) return;
        try {
            const res = await client.request<{ success: boolean; message: string }>('db', 'db.ext.test', { id });
            alert(res.success ? 'Connection successful ✓' : `Connection failed: ${res.message}`);
        } catch (err: any) { alert(`Test failed: ${err?.message}`); }
    };

    const filteredTables = useMemo(() =>
        tableFilter ? tables.filter(t => t.name.toLowerCase().includes(tableFilter.toLowerCase())) : tables,
    [tables, tableFilter]);

    const totalPages = Math.ceil(rowCount / ROWS_PER_PAGE);

    const getTypeIcon = (col: SchemaColumn) => {
        if (col.pk) return <Key size={14} />;
        const t = (col.type ?? '').toLowerCase();
        if (t.includes('int') || t.includes('real') || t.includes('num') || t.includes('float')) return <Hash size={14} />;
        if (t.includes('bool')) return <ToggleLeft size={14} />;
        return <Type size={14} />;
    };

    // Shared sidebar props
    const sidebarProps = {
        mode, setMode, workspaceId, setWorkspaceId, dbId, setDbId,
        connected, connError, isAdmin, loading, connect, disconnect,
        extDbs, selectedExtDb, setSelectedExtDb, loadExtDbs, setShowRegisterDialog,
        testExtDb, removeExtDb, tables: filteredTables, selectedTable,
        tableFilter, setTableFilter, onRefresh: connect,
    };

    return (
        <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden', position: 'relative' }}>
            {/* Mobile sidebar toggle */}
            {isMobile && (
                <Fab
                    size="small"
                    onClick={() => setMobileSidebarOpen(true)}
                    sx={{ position: 'absolute', top: 8, left: 8, zIndex: 10, bgcolor: 'background.paper', color: 'text.primary', boxShadow: 2 }}
                >
                    <PanelLeftOpen size={18} />
                </Fab>
            )}

            {/* Sidebar — Drawer on mobile, Paper on desktop */}
            {isMobile ? (
                <Drawer
                    variant="temporary" open={mobileSidebarOpen}
                    onClose={() => setMobileSidebarOpen(false)}
                    ModalProps={{ keepMounted: true }}
                    sx={{ '& .MuiDrawer-paper': { width: 280 } }}
                >
                    <SidebarContent
                        {...sidebarProps}
                        selectTable={(t: string) => { selectTable(t); setMobileSidebarOpen(false); }}
                    />
                </Drawer>
            ) : (
                <Paper
                    elevation={0} variant="outlined"
                    sx={{ width: 280, minWidth: 280, display: 'flex', flexDirection: 'column', borderRadius: 0, borderTop: 0, borderBottom: 0, borderLeft: 0 }}
                >
                    <SidebarContent {...sidebarProps} selectTable={selectTable} />
                </Paper>
            )}

            {/* Main Content */}
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', pl: isMobile ? 0 : 0 }}>
                {connected && (
                    <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                        <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, py: 0 } }}>
                            <Tab label="Browse" />
                            <Tab label="SQL Query" />
                        </Tabs>
                    </Box>
                )}

                {!connected && (
                    <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                        <Box sx={{ textAlign: 'center', px: 2 }}>
                            <Database size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
                            <Typography variant="h6">Connect to a Database</Typography>
                            <Typography variant="body2">
                                {isMobile ? 'Tap the sidebar button to connect' : 'Use the sidebar to select a connection type'}
                            </Typography>
                        </Box>
                    </Box>
                )}

                {/* Browse Tab */}
                {connected && tabIndex === 0 && (
                    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {selectedTable ? (
                            <>
                                <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                    <TableIcon size={16} />
                                    <Typography variant="subtitle2" fontWeight="bold" fontFamily="monospace" sx={{ fontSize: { xs: '0.75rem', md: '0.875rem' } }}>
                                        {selectedTable}
                                    </Typography>
                                    <Chip label={`${rowCount} rows`} size="small" sx={{ fontSize: '0.7rem' }} />
                                    <Box sx={{ flexGrow: 1 }} />
                                    <Tooltip title="Schema info">
                                        <IconButton size="small" onClick={() => loadSchema(selectedTable)}><Info size={16} /></IconButton>
                                    </Tooltip>
                                </Box>

                                <TableContainer sx={{ flexGrow: 1, overflow: 'auto' }}>
                                    <Table size="small" stickyHeader>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell sx={{ fontWeight: 'bold', fontSize: '0.65rem', color: 'text.secondary', width: 40 }}>#</TableCell>
                                                {columns.map(col => (
                                                    <TableCell
                                                        key={col}
                                                        sx={{ fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap', '&:hover': { bgcolor: 'action.hover' } }}
                                                        onClick={() => handleSort(col)}
                                                    >
                                                        {col} {sortCol === col ? (sortDir === 'ASC' ? '▲' : '▼') : ''}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {tableData.map((row, i) => (
                                                <TableRow key={i} hover>
                                                    <TableCell sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>{(page - 1) * ROWS_PER_PAGE + i + 1}</TableCell>
                                                    {columns.map(col => (
                                                        <TableCell key={col} sx={{ fontSize: '0.75rem', fontFamily: 'monospace', maxWidth: { xs: 150, md: 300 }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {row[col] === null ? <span style={{ color: '#999', fontStyle: 'italic' }}>NULL</span> : String(row[col])}
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>

                                {totalPages > 1 && (
                                    <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'center' }}>
                                        <Pagination count={totalPages} page={page} onChange={handlePageChange} size="small" />
                                    </Box>
                                )}
                            </>
                        ) : (
                            <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                                <Typography variant="body2">{isMobile ? 'Open sidebar to select a table' : 'Select a table from the sidebar'}</Typography>
                            </Box>
                        )}
                    </Box>
                )}

                {/* SQL Tab */}
                {connected && tabIndex === 1 && (
                    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <Box sx={{ p: { xs: 1, md: 2 }, borderBottom: 1, borderColor: 'divider' }}>
                            <TextField
                                fullWidth multiline rows={isMobile ? 3 : 4}
                                placeholder="SELECT * FROM ..."
                                value={sql} onChange={e => setSql(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runSql(); } }}
                                sx={{ fontFamily: 'monospace', '& textarea': { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                            />
                            <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                <Button variant="contained" size="small" startIcon={<Play size={14} />} onClick={runSql} disabled={!sql.trim() || loading}>
                                    Execute
                                </Button>
                                <Button variant="outlined" size="small" startIcon={<X size={14} />} onClick={() => { setSql(''); setQueryResult(null); setQueryError(''); }}>
                                    Clear
                                </Button>
                            </Box>
                        </Box>
                        {queryError && <Alert severity="error" sx={{ m: 2 }}>{queryError}</Alert>}
                        {queryResult && (
                            <TableContainer sx={{ flexGrow: 1, overflow: 'auto' }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            {queryCols.map(col => (
                                                <TableCell key={col} sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>{col}</TableCell>
                                            ))}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {queryResult.map((row, i) => (
                                            <TableRow key={i} hover>
                                                {queryCols.map(col => (
                                                    <TableCell key={col} sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                                                        {row[col] === null ? <span style={{ color: '#999', fontStyle: 'italic' }}>NULL</span> : String(row[col])}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </Box>
                )}
            </Box>

            {/* Schema — Dialog on mobile, Panel on desktop */}
            {schemaOpen && !isMobile && (
                <Paper elevation={0} variant="outlined" sx={{ width: 300, minWidth: 300, borderRadius: 0, borderTop: 0, borderBottom: 0, borderRight: 0, overflow: 'auto' }}>
                    <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
                        <Typography variant="subtitle2" fontWeight="bold">Schema: {selectedTable}</Typography>
                        <IconButton size="small" onClick={() => setSchemaOpen(false)}><X size={16} /></IconButton>
                    </Box>
                    <SchemaList columns={schemaColumns} getTypeIcon={getTypeIcon} />
                </Paper>
            )}
            <Dialog open={schemaOpen && isMobile} onClose={() => setSchemaOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>Schema: {selectedTable}</DialogTitle>
                <DialogContent><SchemaList columns={schemaColumns} getTypeIcon={getTypeIcon} /></DialogContent>
                <DialogActions><Button onClick={() => setSchemaOpen(false)}>Close</Button></DialogActions>
            </Dialog>

            {/* Register External DB Dialog */}
            <Dialog open={showRegisterDialog} onClose={() => setShowRegisterDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Register External Database</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                        <TextField size="small" fullWidth label="Label" value={regForm.label} onChange={e => setRegForm(f => ({ ...f, label: e.target.value }))} required />
                        <Select size="small" fullWidth value={regForm.dbType} onChange={e => setRegForm(f => ({ ...f, dbType: e.target.value }))}>
                            <MenuItem value="postgres">PostgreSQL</MenuItem>
                            <MenuItem value="mysql">MySQL</MenuItem>
                            <MenuItem value="sqlite">SQLite</MenuItem>
                        </Select>
                        {regForm.dbType !== 'sqlite' ? (
                            <>
                                <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
                                    <TextField size="small" fullWidth label="Host" value={regForm.host} onChange={e => setRegForm(f => ({ ...f, host: e.target.value }))} />
                                    <TextField size="small" label="Port" value={regForm.port} onChange={e => setRegForm(f => ({ ...f, port: e.target.value }))} sx={{ width: { xs: '100%', sm: 100 } }} />
                                </Box>
                                <TextField size="small" fullWidth label="Database Name" value={regForm.databaseName} onChange={e => setRegForm(f => ({ ...f, databaseName: e.target.value }))} />
                                <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
                                    <TextField size="small" fullWidth label="Username" value={regForm.username} onChange={e => setRegForm(f => ({ ...f, username: e.target.value }))} />
                                    <TextField size="small" fullWidth label="Password" type="password" value={regForm.password} onChange={e => setRegForm(f => ({ ...f, password: e.target.value }))} />
                                </Box>
                                <FormControlLabel control={<Switch checked={regForm.ssl} onChange={e => setRegForm(f => ({ ...f, ssl: e.target.checked }))} />} label="SSL" />
                            </>
                        ) : (
                            <TextField size="small" fullWidth label="File Path" value={regForm.filePath} onChange={e => setRegForm(f => ({ ...f, filePath: e.target.value }))} helperText="Absolute path to .db or .sqlite file" />
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowRegisterDialog(false)}>Cancel</Button>
                    <Button variant="contained" onClick={registerExtDb} disabled={!regForm.label || !regForm.dbType}>Register</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

// ─── Schema List Sub-component ───────────────────────────────────────────────

function SchemaList({ columns, getTypeIcon }: { columns: SchemaColumn[]; getTypeIcon: (c: SchemaColumn) => React.ReactNode }) {
    return (
        <List dense>
            {columns.map(col => (
                <ListItem key={col.cid ?? col.name}>
                    <ListItemIcon sx={{ minWidth: 28 }}>{getTypeIcon(col)}</ListItemIcon>
                    <ListItemText
                        primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                                <Typography variant="body2" fontFamily="monospace" fontWeight="bold">{col.name}</Typography>
                                {col.pk === 1 && <Chip label="PK" size="small" color="warning" sx={{ height: 16, fontSize: '0.6rem' }} />}
                                {col.notnull === 1 && <Chip label="NOT NULL" size="small" sx={{ height: 16, fontSize: '0.6rem' }} />}
                            </Box>
                        }
                        secondary={`${col.type ?? 'unknown'}${col.dflt_value ? ` = ${col.dflt_value}` : ''}`}
                        secondaryTypographyProps={{ fontSize: '0.7rem', fontFamily: 'monospace' }}
                    />
                </ListItem>
            ))}
        </List>
    );
}
