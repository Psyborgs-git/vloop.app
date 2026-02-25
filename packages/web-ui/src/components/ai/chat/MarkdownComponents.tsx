import { Box, Typography } from '@mui/material';

export const mdComponents = {
    code: ({ children, className, ...rest }: any) => {
        const isBlock = className?.startsWith('language-');
        if (isBlock) return (
            <Box component="pre" sx={{
                bgcolor: 'rgba(0,0,0,0.06)', p: 1.5, borderRadius: 1, overflow: 'auto',
                fontFamily: 'monospace', fontSize: '0.85rem',
                border: '1px solid', borderColor: 'divider', my: 1,
            }}>
                <code className={className} {...rest}>{children}</code>
            </Box>
        );
        return (
            <Box component="code" sx={{ bgcolor: 'rgba(0,0,0,0.06)', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.9em' }}>
                {children}
            </Box>
        );
    },
    p: ({ children }: any) => <Typography variant="body1" sx={{ mb: 1, '&:last-child': { mb: 0 } }}>{children}</Typography>,
    h1: ({ children }: any) => <Typography variant="h5" fontWeight="bold" sx={{ mb: 1 }}>{children}</Typography>,
    h2: ({ children }: any) => <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>{children}</Typography>,
    h3: ({ children }: any) => <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 0.5 }}>{children}</Typography>,
    ul: ({ children }: any) => <Box component="ul" sx={{ pl: 2, my: 0.5 }}>{children}</Box>,
    ol: ({ children }: any) => <Box component="ol" sx={{ pl: 2, my: 0.5 }}>{children}</Box>,
    li: ({ children }: any) => <Box component="li" sx={{ mb: 0.25 }}>{children}</Box>,
    blockquote: ({ children }: any) => (
        <Box sx={{ borderLeft: '3px solid', borderColor: 'primary.main', pl: 2, my: 1, color: 'text.secondary' }}>
            {children}
        </Box>
    ),
    table: ({ children }: any) => (
        <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', my: 1, fontSize: '0.875rem' }}>
            {children}
        </Box>
    ),
    th: ({ children }: any) => (
        <Box component="th" sx={{ border: '1px solid', borderColor: 'divider', p: 1, fontWeight: 'bold', bgcolor: 'action.hover', textAlign: 'left' }}>
            {children}
        </Box>
    ),
    td: ({ children }: any) => (
        <Box component="td" sx={{ border: '1px solid', borderColor: 'divider', p: 1 }}>
            {children}
        </Box>
    ),
};
