import { createTheme, ThemeOptions } from '@mui/material/styles';

const brutalistShadow = '4px 4px 0px #000000';
const brutalistBorder = '2px solid #000000';
const brutalistBorderRadius = 4;

const commonThemeOverrides: ThemeOptions['components'] = {
    MuiButton: {
        styleOverrides: {
            root: {
                textTransform: 'none',
                fontWeight: 600,
                border: brutalistBorder,
                borderRadius: brutalistBorderRadius,
                boxShadow: brutalistShadow,
                transition: 'all 0.1s ease',
                '&:hover': {
                    transform: 'translate(1px, 1px)',
                    boxShadow: '3px 3px 0px #000000',
                },
                '&:active': {
                    transform: 'translate(4px, 4px)',
                    boxShadow: 'none',
                },
            },
            containedPrimary: {
                backgroundColor: '#3b82f6', // Bright blue
                color: '#ffffff',
                '&:hover': {
                    backgroundColor: '#2563eb',
                }
            },
            containedSecondary: {
                backgroundColor: '#10b981', // Emerald green
                color: '#ffffff',
                '&:hover': {
                    backgroundColor: '#059669',
                }
            },
            outlined: {
                backgroundColor: '#ffffff',
                color: '#000000',
                '&:hover': {
                    backgroundColor: '#f8fafc',
                }
            }
        },
    },
    MuiPaper: {
        styleOverrides: {
            root: {
                border: brutalistBorder,
                borderRadius: brutalistBorderRadius,
                boxShadow: brutalistShadow,
            },
            elevation0: {
                boxShadow: brutalistShadow,
            }
        },
    },
    MuiCard: {
        styleOverrides: {
            root: {
                border: brutalistBorder,
                borderRadius: brutalistBorderRadius,
                boxShadow: brutalistShadow,
            },
        },
    },
    MuiOutlinedInput: {
        styleOverrides: {
            root: {
                borderRadius: brutalistBorderRadius,
                backgroundColor: '#ffffff',
                '& .MuiOutlinedInput-notchedOutline': {
                    border: brutalistBorder,
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#000000',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: '#000000',
                    borderWidth: '2px',
                },
                boxShadow: 'inset 2px 2px 0px rgba(0,0,0,0.05)',
            },
            input: {
                color: '#000000', // ensure text is black in inputs for brutalist look
            }
        },
    },
    MuiDrawer: {
        styleOverrides: {
            paper: {
                borderRight: brutalistBorder,
                boxShadow: 'none', // Sidebar usually doesn't need the drop shadow, just the hard border
            },
        },
    },
    MuiAppBar: {
        styleOverrides: {
            root: {
                borderBottom: brutalistBorder,
                boxShadow: 'none',
            }
        }
    },
    MuiListItemButton: {
        styleOverrides: {
            root: {
                borderRadius: brutalistBorderRadius,
                margin: '4px 8px',
                border: '2px solid transparent',
                '&.Mui-selected': {
                    backgroundColor: '#f1f5f9',
                    border: brutalistBorder,
                    boxShadow: '2px 2px 0px #000000',
                    '&:hover': {
                        backgroundColor: '#e2e8f0',
                    }
                },
                '&:hover': {
                    border: '2px solid rgba(0,0,0,0.1)',
                }
            }
        }
    }
};

export const lightTheme = createTheme({
    palette: {
        mode: 'light',
        primary: {
            main: '#3b82f6',
        },
        secondary: {
            main: '#10b981',
        },
        background: {
            default: '#f8fafc', // Light gray background
            paper: '#ffffff',
        },
        error: {
            main: '#ef4444',
        },
        warning: {
            main: '#f59e0b',
        },
        info: {
            main: '#3b82f6',
        },
        success: {
            main: '#10b981',
        },
        text: {
            primary: '#0f172a',
            secondary: '#475569',
        }
    },
    shape: {
        borderRadius: brutalistBorderRadius,
    },
    typography: {
        fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
        h1: { fontWeight: 800 },
        h2: { fontWeight: 800 },
        h3: { fontWeight: 700 },
        h4: { fontWeight: 700 },
        h5: { fontWeight: 700 },
        h6: { fontWeight: 700 },
        button: { fontWeight: 700 },
    },
    components: commonThemeOverrides,
});

export const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#60a5fa', // lighter blue for dark mode
        },
        secondary: {
            main: '#34d399',
        },
        background: {
            default: '#0f172a', // Dark slate
            paper: '#1e293b',
        },
        text: {
            primary: '#f8fafc',
            secondary: '#cbd5e1',
        }
    },
    shape: {
        borderRadius: brutalistBorderRadius,
    },
    typography: {
        fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
        h1: { fontWeight: 800 },
        h2: { fontWeight: 800 },
        h3: { fontWeight: 700 },
        h4: { fontWeight: 700 },
        h5: { fontWeight: 700 },
        h6: { fontWeight: 700 },
        button: { fontWeight: 700 },
    },
    components: {
        ...commonThemeOverrides,
        MuiButton: {
            styleOverrides: {
                ...commonThemeOverrides.MuiButton?.styleOverrides,
                outlined: {
                    backgroundColor: '#1e293b',
                    color: '#f8fafc',
                    '&:hover': {
                        backgroundColor: '#334155',
                    }
                }
            }
        },
        MuiOutlinedInput: {
            styleOverrides: {
                ...commonThemeOverrides.MuiOutlinedInput?.styleOverrides,
                root: {
                    ...(commonThemeOverrides.MuiOutlinedInput?.styleOverrides as any)?.root,
                    backgroundColor: '#1e293b',
                    boxShadow: 'inset 2px 2px 0px rgba(0,0,0,0.5)',
                },
                input: {
                    color: '#f8fafc',
                }
            }
        },
        MuiListItemButton: {
            styleOverrides: {
                root: {
                    borderRadius: brutalistBorderRadius,
                    margin: '4px 8px',
                    border: '2px solid transparent',
                    '&.Mui-selected': {
                        backgroundColor: '#334155',
                        border: brutalistBorder,
                        boxShadow: '2px 2px 0px #000000',
                        '&:hover': {
                            backgroundColor: '#475569',
                        }
                    },
                    '&:hover': {
                        border: '2px solid rgba(255,255,255,0.1)',
                    }
                }
            }
        }
    },
});
