import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { mdComponents } from './MarkdownComponents.js';
import type { ChatMessage } from './types.js';

type RenderPart =
    | { type: 'markdown'; text: string }
    | { type: 'request'; text: string }
    | { type: 'input'; text: string }
    | { type: 'image'; url: string; alt?: string }
    | { type: 'video'; url: string }
    | { type: 'html'; html: string }
    | { type: 'canvas'; url: string };

function tryParseJson(content: string): unknown {
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
}

function detectUrlMedia(text: string): RenderPart | null {
    const trimmed = text.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;

    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(trimmed)) {
        return { type: 'image', url: trimmed };
    }
    if (/\.(mp4|webm|ogg|mov)$/i.test(trimmed)) {
        return { type: 'video', url: trimmed };
    }
    if (/\/canvas\//i.test(trimmed) || /canvas/i.test(trimmed)) {
        return { type: 'canvas', url: trimmed };
    }
    return null;
}

function toRenderPart(value: unknown): RenderPart | null {
    if (!value || typeof value !== 'object') return null;
    const part = value as Record<string, unknown>;
    const type = typeof part.type === 'string' ? part.type.toLowerCase() : '';

    if ((type === 'request' || type === 'user_request') && typeof part.text === 'string') {
        return { type: 'request', text: part.text };
    }
    if ((type === 'input' || type === 'prompt_input') && typeof part.text === 'string') {
        return { type: 'input', text: part.text };
    }
    if (type === 'image' && typeof part.url === 'string') {
        return { type: 'image', url: part.url, alt: typeof part.alt === 'string' ? part.alt : undefined };
    }
    if (type === 'video' && typeof part.url === 'string') {
        return { type: 'video', url: part.url };
    }
    if (type === 'html' && typeof part.html === 'string') {
        return { type: 'html', html: part.html };
    }
    if (type === 'canvas' && typeof part.url === 'string') {
        return { type: 'canvas', url: part.url };
    }
    if ((type === 'markdown' || type === 'text') && typeof part.text === 'string') {
        return { type: 'markdown', text: part.text };
    }
    return null;
}

function buildParts(msg: ChatMessage): RenderPart[] {
    const parts: RenderPart[] = [];
    const metadata = (msg.metadata ?? {}) as Record<string, unknown>;

    const metadataParts = metadata.parts;
    if (Array.isArray(metadataParts)) {
        for (const p of metadataParts) {
            const part = toRenderPart(p);
            if (part) parts.push(part);
        }
    }

    const attachmentList = metadata.attachments;
    if (Array.isArray(attachmentList)) {
        for (const item of attachmentList) {
            if (!item || typeof item !== 'object') continue;
            const att = item as Record<string, unknown>;
            const url = typeof att.url === 'string' ? att.url : '';
            const mime = typeof att.mime === 'string' ? att.mime : '';
            if (!url) continue;
            if (mime.startsWith('image/')) parts.push({ type: 'image', url, alt: typeof att.name === 'string' ? att.name : undefined });
            else if (mime.startsWith('video/')) parts.push({ type: 'video', url });
            else if (mime.includes('html')) parts.push({ type: 'html', html: `<iframe src="${url}" style="width:100%;height:360px;border:0;"></iframe>` });
            else if (/canvas/i.test(url)) parts.push({ type: 'canvas', url });
        }
    }

    const canvasUrl = typeof metadata.canvasUrl === 'string' ? metadata.canvasUrl : '';
    if (canvasUrl) parts.push({ type: 'canvas', url: canvasUrl });

    const html = typeof metadata.html === 'string' ? metadata.html : '';
    if (html) parts.push({ type: 'html', html });

    const content = msg.content?.trim() ?? '';
    if (content.length > 0) {
        const parsed = tryParseJson(content);
        if (Array.isArray(parsed)) {
            for (const item of parsed) {
                const mapped = toRenderPart(item);
                if (mapped) parts.push(mapped);
            }
        } else {
            const mapped = toRenderPart(parsed);
            if (mapped) {
                parts.push(mapped);
            } else {
                const mediaPart = detectUrlMedia(content);
                if (mediaPart) parts.push(mediaPart);
                else if (msg.role === 'user') parts.push({ type: 'request', text: content });
                else parts.push({ type: 'markdown', text: content });
            }
        }
    }

    if (parts.length === 0) {
        return [{ type: 'markdown', text: '' }];
    }

    return parts;
}

export const ChatMessageRenderer = React.memo(function ChatMessageRenderer({ msg }: { msg: ChatMessage }) {
    const parts = buildParts(msg);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {parts.map((part, idx) => {
                if (part.type === 'request') {
                    return (
                        <Typography key={`part-${idx}`} variant="subtitle1" sx={{ whiteSpace: 'pre-wrap', textAlign: "left", textWrap:"wrap" }}>{part.text}</Typography>
                    );
                }

                if (part.type === 'input') {
                    return (
                        <Paper key={`part-${idx}`} variant="outlined" sx={{ p: 1 }}>
                            <Typography variant="caption" color="text.secondary">Input</Typography>
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{part.text}</Typography>
                        </Paper>
                    );
                }

                if (part.type === 'image') {
                    return (
                        <Box
                            key={`part-${idx}`}
                            component="img"
                            src={part.url}
                            alt={part.alt ?? 'chat image'}
                            sx={{ maxWidth: '100%', borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}
                        />
                    );
                }

                if (part.type === 'video') {
                    return (
                        <Box
                            key={`part-${idx}`}
                            component="video"
                            src={part.url}
                            controls
                            sx={{ maxWidth: '100%', borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}
                        />
                    );
                }

                if (part.type === 'html') {
                    return (
                        <Box
                            key={`part-${idx}`}
                            component="iframe"
                            title={`html-message-${idx}`}
                            sandbox="allow-same-origin"
                            srcDoc={part.html}
                            sx={{ width: '100%', minHeight: 220, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}
                        />
                    );
                }

                if (part.type === 'canvas') {
                    return (
                        <Box
                            key={`part-${idx}`}
                            component="iframe"
                            title={`canvas-message-${idx}`}
                            src={part.url}
                            sx={{ width: '100%', minHeight: 280, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}
                        />
                    );
                }

                return (
                    <ReactMarkdown key={`part-${idx}`} remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {part.text}
                    </ReactMarkdown>
                );
            })}
        </Box>
    );
});
