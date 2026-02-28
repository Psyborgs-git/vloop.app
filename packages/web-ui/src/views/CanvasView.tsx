import { Box, Typography, Paper } from '@mui/material';
import { useParams } from 'react-router-dom';

export default function CanvasView() {
    const { id } = useParams<{ id: string }>();

    const defaultHtml = `
      <div style="font-family: system-ui; text-align: center; margin-top: 40px;">
        <h2 style="color: #64748b;">Awaiting UI Generation</h2>
        <p style="color: #94a3b8;">When the agent decides to render data visually, the output will appear here.</p>
        <p style="color: #94a3b8; font-size: 0.9em; margin-top: 20px;">Use the agent to create a canvas. Once created, its UI will be accessible here.</p>
      </div>
    `;

    // Port configured in config.toml
    const canvasRenderUrl = id ? `http://localhost:9445/${id}` : undefined;

    return (
        <Box sx={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', p: 4, maxWidth: 1400, mx: 'auto' }}>
            <Box sx={{ mb: 3 }}>
                <Typography variant="h4" fontWeight="bold">Dynamic Canvas {id && `<${id}>`}</Typography>
                <Typography variant="body1" color="text.secondary">Agent generated UI will render here safely.</Typography>
            </Box>

            <Paper
                elevation={0}
                variant="outlined"
                sx={{
                    flexGrow: 1,
                    borderRadius: 2,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: 'background.default'
                }}
            >
                <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', gap: 2 }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'error.main' }} />
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'warning.main' }} />
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'success.main' }} />
                    </Box>
                    <Typography variant="body2" color="text.secondary" fontFamily="monospace">
                        {canvasRenderUrl || 'sandbox-renderer://localhost'}
                    </Typography>
                </Box>
                <Box sx={{ flexGrow: 1, position: 'relative' }}>
                    {canvasRenderUrl ? (
                        <iframe
                            title="Canvas Output"
                            src={canvasRenderUrl}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }}
                            sandbox="allow-scripts allow-forms allow-same-origin"
                        />
                    ) : (
                        <iframe
                            title="Canvas Output"
                            srcDoc={defaultHtml}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }}
                            sandbox="allow-scripts"
                        />
                    )}
                </Box>
            </Paper>
        </Box>
    );
}
