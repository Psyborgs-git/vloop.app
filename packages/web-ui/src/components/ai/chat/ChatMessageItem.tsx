import { Box, Avatar, Typography, Paper, Accordion, AccordionSummary, AccordionDetails, Chip, ListItem, CircularProgress, Tooltip, IconButton, Stack, alpha } from '@mui/material';
import { User as UserIcon, Command, Bot, ChevronDown, Wrench, Brain, RotateCcw, GitFork } from 'lucide-react';
import { ChatMessage } from './types.js';
import { useState, useEffect } from 'react';
import { ChatMessageRenderer } from './ChatMessageRenderer.js';

interface ChatMessageItemProps {
    msg: ChatMessage;
    onRerun?: (messageId: string) => void;
    onFork?: (messageId: string) => void;
    disabledActions?: boolean;
    isGrouped: boolean;
}

export function ChatMessageItem({ msg, onRerun, onFork, disabledActions = false, isGrouped = false }: ChatMessageItemProps) {
    const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);
    const [isHovered, setIsHovered] = useState(false);

    // Parse <think> blocks
    let content = msg.content || '';
    let thinkingContent = '';
    let isThinking = false;

    const thinkStartIdx = content.indexOf('<think>');
    if (thinkStartIdx !== -1) {
        const thinkEndIdx = content.indexOf('</think>');
        if (thinkEndIdx !== -1) {
            thinkingContent = content.substring(thinkStartIdx + 7, thinkEndIdx).trim();
            content = content.substring(0, thinkStartIdx) + content.substring(thinkEndIdx + 8);
            isThinking = false;
        } else {
            thinkingContent = content.substring(thinkStartIdx + 7).trim();
            content = content.substring(0, thinkStartIdx);
            isThinking = true;
        }
    }

    // Auto-collapse thinking block when thinking finishes
    useEffect(() => {
        if (!isThinking && thinkingContent) {
            setIsThinkingExpanded(false);
        } else if (isThinking) {
            setIsThinkingExpanded(true);
        }
    }, [isThinking, thinkingContent]);

    const canBranch = !!msg.id && msg.role === 'assistant';

    return (
        <ListItem
            disablePadding
            sx={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <Box sx={{
                display: 'flex', gap: 1.5, maxWidth: '86%',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            }}>
                <Avatar
                    sx={{
                        bgcolor: isGrouped ? 'transparent' : msg.role === 'user' ? 'primary.main' : msg.role === 'system' ? 'warning.main' : 'secondary.main',
                        width: 32, height: 32,
                        alignSelf: 'flex-start',
                    }}>
                    {
                        isGrouped ? <Box /> :
                            msg.role === 'user' ? <UserIcon size={16} />
                                : msg.role === 'system' ? <Command size={16} />
                                    : <Bot size={16} />
                    }
                </Avatar>
                <Box
                    component="span"
                    sx={{
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5,

                    }}>
                    {msg.role !== "user" &&
                        <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                            {msg.role === 'system' ? 'System' : 'AI Assistant'}
                        </Typography>
                    }
                    <Box
                        component={Stack}
                        sx={
                            msg.role === 'user' ? {
                                borderTopRightRadius: msg.role === 'user' ? 4 : 24,
                                borderTopLeftRadius: msg.role !== 'user' ? 4 : 24,
                                borderRadius: 3,
                                px: 2.5, py: 1.5,
                                boxShadow: theme => `0 2px 8px ${alpha(theme.palette.divider, 0.05)}`,
                            } : {px: .5, py: 2}
                        }>
                        <Box>
                            {msg.role !== 'user' && thinkingContent && (
                                <Accordion
                                    expanded={isThinkingExpanded}
                                    onChange={(_, expanded) => setIsThinkingExpanded(expanded)}
                                    variant="outlined"
                                    disableGutters
                                    sx={{ mb: 2, bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 2, '&:before': { display: 'none' } }}
                                >
                                    <AccordionSummary
                                        expandIcon={<ChevronDown size={16} />}
                                        sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Brain size={14} />
                                            <Typography variant="body2" fontWeight={500} sx={{
                                                background: isThinking ? 'linear-gradient(90deg, #888 0%, #333 50%, #888 100%)' : 'inherit',
                                                backgroundSize: '200% auto',
                                                color: isThinking ? 'transparent' : 'text.secondary',
                                                WebkitBackgroundClip: isThinking ? 'text' : 'unset',
                                                animation: isThinking ? 'shimmer 2s linear infinite' : 'none',
                                                '@keyframes shimmer': {
                                                    '0%': { backgroundPosition: '200% center' },
                                                    '100%': { backgroundPosition: '0% center' }
                                                }
                                            }}>
                                                {isThinking ? 'Thinking...' : 'Thought Process'}
                                            </Typography>
                                        </Box>
                                    </AccordionSummary>
                                    <AccordionDetails sx={{ p: 1.5, pt: 0 }}>
                                        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', fontStyle: 'italic' }}>
                                            {thinkingContent}
                                        </Typography>
                                    </AccordionDetails>
                                </Accordion>
                            )}
                            {content ? (
                                <ChatMessageRenderer msg={{ ...msg, content }} />
                            ) : (
                                !thinkingContent && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                                        <CircularProgress size={14} thickness={5} />
                                        <Typography variant="body2" color="text.secondary" sx={{
                                            background: 'linear-gradient(90deg, #888 0%, #333 50%, #888 100%)',
                                            backgroundSize: '200% auto',
                                            color: 'transparent',
                                            WebkitBackgroundClip: 'text',
                                            animation: 'shimmer 2s linear infinite',
                                        }}>
                                            Thinking...
                                        </Typography>
                                    </Box>
                                )
                            )}
                            {(msg.toolCalls?.length ?? 0) > 0 && (
                                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {msg.toolCalls!.map((tc, idx) => {
                                        const result = msg.toolResults?.find(
                                            tr => tr.callId === tc.id || (tr as any).name === tc.name
                                        );
                                        const isLongRunning = msg.longRunningToolIds?.includes(tc.id);
                                        const needsConfirmation = !!msg.requestedToolConfirmations?.[tc.id];
                                        return (
                                            <Accordion
                                                key={tc.id ?? idx}
                                                variant="outlined"
                                                disableGutters
                                                sx={{ bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 2, '&:before': { display: 'none' } }}
                                            >
                                                <AccordionSummary
                                                    expandIcon={<ChevronDown size={16} />}
                                                    sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}
                                                >
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Wrench size={14} />
                                                        <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                                                            {tc.name}
                                                        </Typography>
                                                        {isLongRunning && (
                                                            <Chip label="Running…" size="small" color="info" sx={{ height: 20, fontSize: '0.65rem' }} />
                                                        )}
                                                        {needsConfirmation && (
                                                            <Chip label="Confirm?" size="small" color="warning" sx={{ height: 20, fontSize: '0.65rem' }} />
                                                        )}
                                                    </Box>
                                                </AccordionSummary>
                                                <AccordionDetails sx={{ p: 1.5, pt: 0 }}>
                                                    <Box sx={{ bgcolor: 'rgba(0,0,0,0.04)', p: 1.5, borderRadius: 1, mb: 1, overflowX: 'auto' }}>
                                                        <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ display: 'block', mb: 0.5 }}>
                                                            Arguments
                                                        </Typography>
                                                        <Typography variant="body2" fontFamily="monospace" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
                                                            {JSON.stringify(tc.arguments, null, 2)}
                                                        </Typography>
                                                    </Box>
                                                    {result && (
                                                        <Box sx={{ bgcolor: 'rgba(0,0,0,0.04)', p: 1.5, borderRadius: 1, overflowX: 'auto' }}>
                                                            <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ display: 'block', mb: 0.5 }}>
                                                                Result
                                                            </Typography>
                                                            <Typography variant="body2" fontFamily="monospace" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
                                                                {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
                                                            </Typography>
                                                        </Box>
                                                    )}
                                                </AccordionDetails>
                                            </Accordion>
                                        );
                                    })}
                                </Box>
                            )}
                        </Box>
                    </Box>
                    {canBranch && (
                        <Box sx={{
                            className: 'chat-message-actions',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            gap: 0.5,
                            px: 0.5,
                            mt: 0.25,
                            opacity: isHovered ? 1 : 0,
                            transition: 'opacity 0.15s ease',
                        }}>
                            <Tooltip title="Re-run from here">
                                <span>
                                    <IconButton
                                        size="small"
                                        disabled={disabledActions}
                                        onClick={() => msg.id && onRerun?.(msg.id)}
                                    >
                                        <RotateCcw size={14} />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="Fork chat from here">
                                <span>
                                    <IconButton
                                        size="small"
                                        disabled={disabledActions}
                                        onClick={() => msg.id && onFork?.(msg.id)}
                                    >
                                        <GitFork size={14} />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </Box>
                    )}

                </Box>
            </Box>
        </ListItem>
    );
}
