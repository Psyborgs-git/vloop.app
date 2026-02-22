import React, { createContext, useContext, useEffect, useState } from 'react';
import { OrchestratorClient } from '@orch/client';

export const ClientContext = createContext<OrchestratorClient | null>(null);

export function useClient() {
    return useContext(ClientContext);
}

export function ClientProvider({ children }: { children: React.ReactNode }) {
    const [client, setClient] = useState<OrchestratorClient | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        async function init() {
            try {
                const orch = new OrchestratorClient({
                    url: 'ws://127.0.0.1:9001',
                    token: 'admin-token',
                    timeoutMs: 5000
                });

                // For development, we skip the actual connection wait to allow UI to render
                // In production, we would await orch.connect() or similar if the SDK required it
                if (mounted) {
                    setClient(orch);
                }
            } catch (err: any) {
                if (mounted) setError(err.message);
            }
        }

        init();

        return () => {
            mounted = false;
        };
    }, []);

    if (error) {
        return <div className="p-8 text-red-500">Failed to connect to Daemon: {error}</div>;
    }

    if (!client) {
        return <div className="p-8 flex items-center gap-3"><div className="animate-spin h-5 w-5 border-2 border-primary-500 rounded-full border-t-transparent"></div> Connecting to Orchestrator...</div>;
    }

    return (
        <ClientContext.Provider value={client}>
            {children}
        </ClientContext.Provider>
    );
}
