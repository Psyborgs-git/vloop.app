import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { useChat } from '../../../hooks/useChat.js';

type ChatController = ReturnType<typeof useChat>;

const ChatControllerContext = createContext<ChatController | null>(null);

export function ChatControllerProvider({ value, children }: { value: ChatController; children: ReactNode }) {
    return (
        <ChatControllerContext.Provider value={value}>
            {children}
        </ChatControllerContext.Provider>
    );
}

export function useChatController(): ChatController {
    const ctx = useContext(ChatControllerContext);
    if (!ctx) {
        throw new Error('useChatController must be used within ChatControllerProvider');
    }
    return ctx;
}
