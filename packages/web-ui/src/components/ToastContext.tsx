import React, { createContext, useContext, useState, useCallback } from 'react';
import {
    Alert,
    AlertColor,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Slide,
    Stack,
    TextField,
} from '@mui/material';

type PromptInputType = 'text' | 'password' | 'number' | 'email';

interface PromptDialogOptions {
    title?: string;
    message: string;
    placeholder?: string;
    defaultValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    inputType?: PromptInputType;
}

interface PromptDialogResult {
    confirmed: boolean;
    value?: string;
}

interface ToastItem {
    id: string;
    message: string;
    severity: AlertColor;
}

interface ToastContextType {
    showToast: (message: string, severity?: AlertColor) => void;
    showInputDialog: (options: PromptDialogOptions) => Promise<PromptDialogResult>;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [promptOpen, setPromptOpen] = useState(false);
    const [promptTitle, setPromptTitle] = useState('Input required');
    const [promptMessage, setPromptMessage] = useState('');
    const [promptPlaceholder, setPromptPlaceholder] = useState('');
    const [promptInputType, setPromptInputType] = useState<PromptInputType>('text');
    const [promptConfirmLabel, setPromptConfirmLabel] = useState('Confirm');
    const [promptCancelLabel, setPromptCancelLabel] = useState('Cancel');
    const [promptValue, setPromptValue] = useState('');
    const [promptResolver, setPromptResolver] = useState<((result: PromptDialogResult) => void) | null>(null);

    const showToast = useCallback((msg: string, sev: AlertColor = 'info') => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((prev) => [...prev, { id, message: msg, severity: sev }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((item) => item.id !== id));
        }, 4200);
    }, []);

    const dismissToast = (id: string) => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
    };

    const showInputDialog = useCallback((options: PromptDialogOptions): Promise<PromptDialogResult> => {
        setPromptTitle(options.title || 'Input required');
        setPromptMessage(options.message);
        setPromptPlaceholder(options.placeholder || '');
        setPromptInputType(options.inputType || 'text');
        setPromptConfirmLabel(options.confirmLabel || 'Confirm');
        setPromptCancelLabel(options.cancelLabel || 'Cancel');
        setPromptValue(options.defaultValue || '');
        setPromptOpen(true);

        return new Promise((resolve) => {
            setPromptResolver(() => resolve);
        });
    }, []);

    const closePrompt = (result: PromptDialogResult) => {
        setPromptOpen(false);
        const resolver = promptResolver;
        setPromptResolver(null);
        resolver?.(result);
    };

    return (
        <ToastContext.Provider value={{ showToast, showInputDialog }}>
            {children}
            <Stack
                spacing={1}
                sx={{
                    position: 'fixed',
                    top: 16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 'min(92vw, 560px)',
                    zIndex: (theme) => theme.zIndex.tooltip + 5,
                    pointerEvents: 'none',
                }}
            >
                {toasts.map((toast) => (
                    <Slide key={toast.id} in direction="down" mountOnEnter unmountOnExit>
                        <Alert
                            severity={toast.severity}
                            onClose={() => dismissToast(toast.id)}
                            variant="filled"
                            sx={{
                                pointerEvents: 'auto',
                                borderRadius: 2,
                                boxShadow: '0 10px 28px rgba(0,0,0,0.22)',
                                backdropFilter: 'blur(4px)',
                            }}
                        >
                            {toast.message}
                        </Alert>
                    </Slide>
                ))}
            </Stack>

            <Dialog
                open={promptOpen}
                onClose={() => closePrompt({ confirmed: false })}
                maxWidth="xs"
                fullWidth
                PaperProps={{
                    sx: {
                        borderRadius: 3,
                        border: '1px solid',
                        borderColor: 'divider',
                        boxShadow: '0 28px 70px rgba(0,0,0,0.34)',
                        backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0))',
                    },
                }}
            >
                <DialogTitle sx={{ pb: 1 }}>{promptTitle}</DialogTitle>
                <DialogContent>
                    <Box sx={{ color: 'text.secondary', fontSize: 14, mb: 1.25 }}>
                        {promptMessage}
                    </Box>
                    <TextField
                        autoFocus
                        fullWidth
                        placeholder={promptPlaceholder}
                        type={promptInputType}
                        value={promptValue}
                        onChange={(event) => setPromptValue(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                closePrompt({ confirmed: true, value: promptValue });
                            }
                        }}
                    />
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => closePrompt({ confirmed: false })} color="inherit">
                        {promptCancelLabel}
                    </Button>
                    <Button variant="contained" onClick={() => closePrompt({ confirmed: true, value: promptValue })}>
                        {promptConfirmLabel}
                    </Button>
                </DialogActions>
            </Dialog>
        </ToastContext.Provider>
    );
};
