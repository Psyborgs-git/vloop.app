import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChatMode, ChatSession, ProviderInfo, ModelInfo, ToolInfo, AgentInfo, ChatMessage, ToolCall, ToolResult } from '../components/ai/chat/index.js';

export function useChat(client: any, showToast: (msg: string, type: 'success' | 'error' | 'warning' | 'info') => void) {
    const AUTO_COMPACT_CONTEXT_CHARS = 24_000;

    // Chat state
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState('');
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    // Selections
    const [mode, setMode] = useState<ChatMode>('chat');
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [tools, setTools] = useState<ToolInfo[]>([]);
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [selectedModelId, setSelectedModelId] = useState('');
    const [selectedAgentId, setSelectedAgentId] = useState('');
    const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);

    const activeSession = sessions.find(s => s.id === activeSessionId);

    const requestAgent = useCallback(async <T = any>(action: string, payload: any): Promise<T> => {
        return client.request('agent', action, payload) as Promise<T>;
    }, [client]);

    const requestAgentStream = useCallback(<Chunk = any, Result = any>(action: string, payload: any): AsyncGenerator<Chunk, Result, undefined> => {
        return client.requestStream('agent', action, payload) as AsyncGenerator<Chunk, Result, undefined>;
    }, [client]);

    const loadSessionData = useCallback(async (sessionId: string) => {
        if (!client || !sessionId) return;
        const [history, sessionToolsRes] = await Promise.all([
            client.agent.getChatHistory(sessionId),
            client.agent.getSessionTools(sessionId),
        ]);
        const toolIds = (sessionToolsRes.tools as any[]).map(t => t.id);
        setSessions(prev => prev.map(s => s.id !== sessionId ? s : {
            ...s,
            toolIds,
            updatedAt: new Date().toISOString(),
            messages: history.messages.length > 0
                ? (history.messages as any[]).map(m => ({
                    id: m.id,
                    role: m.role as ChatMessage['role'],
                    content: m.content,
                    toolCalls: m.toolCalls as ToolCall[],
                    toolResults: m.toolResults as ToolResult[],
                    metadata: m.metadata,
                    createdAt: m.createdAt,
                }))
                : [{ role: 'system' as const, content: 'Select a mode and model to start chatting.' }],
        }));
        setSelectedToolIds(toolIds);
    }, [client]);

    // ─── Load configs ────────────────────────────────────────────────

    const loadConfigs = useCallback(async () => {
        if (!client) return;
        try {
            const [provRes, modRes, toolRes, agentRes, chatRes] = await Promise.all([
                client.agent.listProviders(),
                client.agent.listModels(),
                client.agent.listTools(),
                client.agent.listAgents(),
                client.agent.listChats(),
            ]);
            setProviders(provRes.providers || []);
            setModels(modRes.models || []);
            setTools(toolRes.tools || []);
            setAgents(agentRes.agents || []);
            if (!selectedModelId && modRes.models?.length > 0) {
                setSelectedModelId(modRes.models[0].id);
            }

            if (chatRes.sessions?.length > 0) {
                const normalized: ChatSession[] = (chatRes.sessions as any[]).map(s => ({
                    id: s.id, title: s.title, messages: [], toolIds: s.toolIds ?? [], updatedAt: s.updatedAt,
                }));
                setSessions(normalized);
                setActiveSessionId(prev => prev || normalized[0]!.id);
            } else {
                const created = await client.agent.createChat({ title: 'New Chat', mode: 'chat' });
                setSessions([{
                    id: created.id, title: created.title,
                    messages: [{ role: 'system', content: 'Select a mode and model to start chatting.' }],
                    toolIds: (created as any).toolIds ?? [],
                }]);
                setActiveSessionId(created.id);
            }
        } catch (e: any) {
            showToast(`Failed to load AI configs: ${e.message}`, 'error');
        }
    }, [client, selectedModelId, showToast]);

    useEffect(() => { loadConfigs(); }, [loadConfigs]);

    // Load chat history + session tools when session changes
    useEffect(() => {
        if (!client || !activeSessionId) return;
        (async () => {
            try {
                await loadSessionData(activeSessionId);
            } catch (e: any) {
                showToast(`Failed to load chat history: ${e.message}`, 'error');
            }
        })();
    }, [client, activeSessionId, loadSessionData, showToast]);

    // Persist tool selection to section whenever it changes
    const persistToolSelection = useCallback(async (sessionId: string, toolIds: string[]) => {
        if (!client || !sessionId) return;
        try {
            await client.agent.setSessionTools(sessionId, toolIds);
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, toolIds } : s));
        } catch (e: any) {
            showToast(`Failed to persist session tools: ${e.message}`, 'error');
        }
    }, [client, showToast]);

    // ─── Models grouped by provider ──────────────────────────────────

    const modelsByProvider = useMemo(() => {
        const groups = new Map<string, { provider: ProviderInfo; models: ModelInfo[] }>();
        for (const p of providers) groups.set(p.id, { provider: p, models: [] });
        for (const m of models) {
            const g = groups.get(m.providerId);
            if (g) g.models.push(m);
        }
        return Array.from(groups.values()).filter(g => g.models.length > 0);
    }, [providers, models]);

    // ─── Session management ──────────────────────────────────────────

    const handleNewChat = async () => {
        if (!client) return;
        const created = await client.agent.createChat({
            title: `Chat ${sessions.length + 1}`,
            mode,
            modelId: selectedModelId || undefined,
            toolIds: selectedToolIds.length > 0 ? selectedToolIds : undefined,
        });
        const newSession: ChatSession = {
            id: created.id,
            title: created.title,
            messages: [{ role: 'system', content: 'New session started.' }],
            toolIds: (created as any).toolIds ?? selectedToolIds,
            updatedAt: new Date().toISOString(),
        };
        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(created.id);
    };

    // ─── Send message ────────────────────────────────────────────────

    const handleSend = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!input.trim() || !client || !activeSession) return;

        const currentContextChars = activeSession.messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
        if (currentContextChars > AUTO_COMPACT_CONTEXT_CHARS) {
            try {
                const compactResult = typeof client.agent?.compactChatContext === 'function'
                    ? await client.agent.compactChatContext(activeSessionId, {
                        maxChars: AUTO_COMPACT_CONTEXT_CHARS,
                        keepLastMessages: 12,
                    })
                    : await requestAgent<any>('chat.compact', {
                        sessionId: activeSessionId,
                        maxChars: AUTO_COMPACT_CONTEXT_CHARS,
                        keepLastMessages: 12,
                    });
                if (compactResult?.compacted) {
                    showToast('Context was automatically compacted to fit the model window.', 'info');
                    await loadSessionData(activeSessionId);
                }
            } catch (compactErr: any) {
                showToast(`Auto-compaction skipped: ${compactErr.message}`, 'warning');
            }
        }

        const userMsg = input.trim();
        const assistantMsgId = `assistant-${Date.now()}`;

        setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
            ...s,
            messages: [
                ...s.messages,
                { id: Date.now().toString(), role: 'user' as const, content: userMsg },
                { id: assistantMsgId, role: 'assistant' as const, content: '' },
            ],
        }));
        setInput('');
        setLoading(true);

        try {
            let stream: AsyncGenerator<any, any, undefined>;

            if (mode === 'chat') {
                if (!selectedModelId) { showToast('Select a model.', 'warning'); setLoading(false); return; }
                stream = client.agent.chatCompletionStream({
                    modelId: selectedModelId,
                    prompt: userMsg,
                    sessionId: activeSessionId,
                    toolIds: selectedToolIds.length > 0 ? selectedToolIds : undefined,
                });
            } else {
                if (selectedAgentId) {
                    stream = client.agent.runAgentChat(selectedAgentId, activeSessionId, userMsg, {
                        toolIds: selectedToolIds.length > 0 ? selectedToolIds : undefined,
                    });
                } else if (selectedModelId) {
                    stream = client.agent.chatCompletionStream({
                        modelId: selectedModelId,
                        prompt: userMsg,
                        sessionId: activeSessionId,
                        toolIds: selectedToolIds.length > 0 ? selectedToolIds : undefined,
                    });
                } else {
                    showToast('Select an agent or model.', 'warning'); setLoading(false); return;
                }
            }

            for await (const chunk of stream) {
                setLoading(false);

                if (chunk?.toolCalls) {
                    setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                        ...s, messages: s.messages.map(msg => msg.id !== assistantMsgId ? msg : {
                            ...msg, toolCalls: [...(msg.toolCalls ?? []), ...chunk.toolCalls],
                        }),
                    }));
                    continue;
                }
                if (chunk?.toolResult) {
                    setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                        ...s, messages: s.messages.map(msg => msg.id !== assistantMsgId ? msg : {
                            ...msg, toolResults: [...(msg.toolResults ?? []), chunk.toolResult],
                        }),
                    }));
                    continue;
                }
                if (chunk?.requestedToolConfirmations || chunk?.longRunningToolIds) {
                    setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                        ...s, messages: s.messages.map(msg => msg.id !== assistantMsgId ? msg : {
                            ...msg,
                            requestedToolConfirmations: chunk.requestedToolConfirmations ?? msg.requestedToolConfirmations,
                            longRunningToolIds: chunk.longRunningToolIds ?? msg.longRunningToolIds,
                        }),
                    }));
                }

                const textDelta: string =
                    typeof chunk === 'string' ? chunk :
                        chunk?.content?.parts?.[0]?.text ??
                        chunk?.text ??
                        (typeof chunk?.content === 'string' ? chunk.content : '');
                if (!textDelta) continue;

                setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                    ...s, messages: s.messages.map(msg => msg.id !== assistantMsgId ? msg : {
                        ...msg, content: msg.content + textDelta,
                    }),
                }));
            }
        } catch (err: any) {
            showToast(`Error: ${err.message}`, 'error');
            setSessions(prev => prev.map(s => s.id !== activeSessionId ? s : {
                ...s, messages: [...s.messages, {
                    id: `err-${Date.now()}`, role: 'system' as const, content: `Error: ${err.message}`,
                }],
            }));
        } finally {
            setLoading(false);
        }
    };

    const handleToolToggle = async (id: string) => {
        const next = selectedToolIds.includes(id)
            ? selectedToolIds.filter(t => t !== id)
            : [...selectedToolIds, id];
        setSelectedToolIds(next);
        if (activeSessionId) await persistToolSelection(activeSessionId, next);
    };

    const handleRerun = async (messageId: string) => {
        if (!client || !activeSessionId) return;
        setLoading(true);
        try {
            const stream = typeof client.agent?.rerunChatFromMessage === 'function'
                ? client.agent.rerunChatFromMessage(activeSessionId, messageId, {
                    toolIds: selectedToolIds.length > 0 ? selectedToolIds : undefined,
                })
                : requestAgentStream('chat.rerun', {
                    sessionId: activeSessionId,
                    messageId,
                    toolIds: selectedToolIds.length > 0 ? selectedToolIds : undefined,
                });
            for await (const _chunk of stream) {
                // Consume stream to completion; reload persisted history below.
            }
            await loadSessionData(activeSessionId);
            showToast('Response regenerated from selected step.', 'success');
        } catch (e: any) {
            showToast(`Failed to regenerate response: ${e.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleFork = async (messageId: string) => {
        if (!client || !activeSessionId) return;
        setLoading(true);
        try {
            const result = typeof client.agent?.forkChatFromMessage === 'function'
                ? await client.agent.forkChatFromMessage(activeSessionId, messageId)
                : await requestAgent<any>('chat.fork', {
                    sessionId: activeSessionId,
                    messageId,
                });
            const nextSession = result.session;
            setSessions(prev => [{
                id: nextSession.id,
                title: nextSession.title,
                messages: [],
                toolIds: nextSession.toolIds ?? [],
                updatedAt: nextSession.updatedAt,
            }, ...prev]);
            setActiveSessionId(nextSession.id);
            await loadSessionData(nextSession.id);
            showToast('Forked chat created.', 'success');
        } catch (e: any) {
            showToast(`Failed to fork chat: ${e.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCompactContext = async () => {
        if (!client || !activeSessionId) return;
        setLoading(true);
        try {
            const result = typeof client.agent?.compactChatContext === 'function'
                ? await client.agent.compactChatContext(activeSessionId, {
                    maxChars: AUTO_COMPACT_CONTEXT_CHARS,
                    keepLastMessages: 12,
                })
                : await requestAgent<any>('chat.compact', {
                    sessionId: activeSessionId,
                    maxChars: AUTO_COMPACT_CONTEXT_CHARS,
                    keepLastMessages: 12,
                });
            await loadSessionData(activeSessionId);
            if (result.compacted) {
                showToast(`Context compacted (${result.deletedMessages} older messages summarized).`, 'success');
            } else {
                showToast('Context is already within safe limits; no compaction needed.', 'info');
            }
        } catch (e: any) {
            showToast(`Failed to compact context: ${e.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    return {
        sessions,
        activeSessionId,
        setActiveSessionId,
        activeSession,
        input,
        setInput,
        loading,
        mode,
        setMode,
        providers,
        models,
        tools,
        agents,
        selectedModelId,
        setSelectedModelId,
        selectedAgentId,
        setSelectedAgentId,
        selectedToolIds,
        setSelectedToolIds,
        modelsByProvider,
        handleNewChat,
        handleSend,
        handleToolToggle,
        handleRerun,
        handleFork,
        handleCompactContext,
    };
}
