import { createContext, useContext } from 'react';
import { OrchestratorClient } from '@orch/client';

export const ClientContext = createContext<OrchestratorClient | null>(null);

export function useClient() {
    return useContext(ClientContext);
}

