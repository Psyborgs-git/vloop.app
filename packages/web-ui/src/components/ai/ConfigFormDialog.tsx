/**
 * ConfigFormDialog — Shared create/edit dialog for AI config entities.
 *
 * Dynamically renders form fields based on a field schema.
 */

import { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Select, MenuItem, FormControl, InputLabel,
    Box, Chip, IconButton, Typography,
} from '@mui/material';
import { X } from 'lucide-react';

export interface FieldDef {
    name: string;
    label: string;
    type: 'text' | 'select' | 'multiline' | 'json' | 'number' | 'chips';
    required?: boolean;
    options?: { value: string; label: string }[];
    default?: any;
}

interface Props {
    open: boolean;
    onClose: () => void;
    onSubmit: (data: Record<string, any>) => void;
    title: string;
    fields: FieldDef[];
    initialData?: Record<string, any>;
}

export default function ConfigFormDialog({ open, onClose, onSubmit, title, fields, initialData }: Props) {
    const [values, setValues] = useState<Record<string, any>>({});

    useEffect(() => {
        if (open) {
            const defaults: Record<string, any> = {};
            for (const f of fields) {
                defaults[f.name] = initialData?.[f.name] ?? f.default ?? (f.type === 'json' ? '{}' : f.type === 'chips' ? [] : '');
            }
            setValues(defaults);
        }
    }, [open, fields, initialData]);

    const handleChange = (name: string, value: any) => {
        setValues(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = () => {
        const result: Record<string, any> = {};
        for (const f of fields) {
            let val = values[f.name];
            if (f.type === 'json' && typeof val === 'string') {
                try { val = JSON.parse(val); } catch { /* keep string */ }
            }
            if (f.type === 'number' && typeof val === 'string') {
                val = parseFloat(val) || 0;
            }
            result[f.name] = val;
        }
        onSubmit(result);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">{title}</Typography>
                <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    {fields.map(f => {
                        switch (f.type) {
                            case 'select':
                                return (
                                    <FormControl key={f.name} fullWidth size="small">
                                        <InputLabel>{f.label}</InputLabel>
                                        <Select
                                            value={values[f.name] ?? ''}
                                            label={f.label}
                                            onChange={e => handleChange(f.name, e.target.value)}
                                        >
                                            {f.options?.map(o => (
                                                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                );
                            case 'multiline':
                            case 'json':
                                return (
                                    <TextField
                                        key={f.name}
                                        label={f.label}
                                        multiline
                                        minRows={f.type === 'json' ? 4 : 3}
                                        value={typeof values[f.name] === 'object' ? JSON.stringify(values[f.name], null, 2) : values[f.name] ?? ''}
                                        onChange={e => handleChange(f.name, e.target.value)}
                                        size="small"
                                        fullWidth
                                        sx={f.type === 'json' ? { fontFamily: 'monospace' } : {}}
                                    />
                                );
                            case 'number':
                                return (
                                    <TextField
                                        key={f.name}
                                        label={f.label}
                                        type="number"
                                        value={values[f.name] ?? ''}
                                        onChange={e => handleChange(f.name, e.target.value)}
                                        size="small"
                                        fullWidth
                                    />
                                );
                            case 'chips':
                                return (
                                    <Box key={f.name}>
                                        <Typography variant="caption" color="text.secondary">{f.label}</Typography>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                            {(values[f.name] as string[] || []).map((chip: string, i: number) => (
                                                <Chip key={i} label={chip} size="small" onDelete={() => {
                                                    const arr = [...(values[f.name] as string[])];
                                                    arr.splice(i, 1);
                                                    handleChange(f.name, arr);
                                                }} />
                                            ))}
                                        </Box>
                                        <TextField
                                            placeholder={`Add ${f.label.toLowerCase()}`}
                                            size="small"
                                            fullWidth
                                            sx={{ mt: 0.5 }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    const input = e.target as HTMLInputElement;
                                                    if (input.value) {
                                                        handleChange(f.name, [...(values[f.name] as string[] || []), input.value]);
                                                        input.value = '';
                                                    }
                                                }
                                            }}
                                        />
                                    </Box>
                                );
                            default:
                                return (
                                    <TextField
                                        key={f.name}
                                        label={f.label}
                                        required={f.required}
                                        value={values[f.name] ?? ''}
                                        onChange={e => handleChange(f.name, e.target.value)}
                                        size="small"
                                        fullWidth
                                    />
                                );
                        }
                    })}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" onClick={handleSubmit}>
                    {initialData ? 'Update' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
