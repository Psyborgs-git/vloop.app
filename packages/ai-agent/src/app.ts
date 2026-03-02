import type { DependencyContainer } from "tsyringe";
import type { AppConfig } from "@orch/shared";
import { TOKENS } from "@orch/shared";

import {
    AgentSandbox,
    ToolRegistry,
    AgentOrchestrator,
    AIConfigStore,
} from "./index.js";

const config: AppConfig = {
    name: "@orch/ai-agent",
    register(container: DependencyContainer) {
        container.register(AgentSandbox, {
            useFactory: (c) => new AgentSandbox(c.resolve(TOKENS.Logger))
        });
        container.register(ToolRegistry, {
            useFactory: (c) => new ToolRegistry(c.resolve(TOKENS.Logger))
        });
        container.register(AIConfigStore, {
            useFactory: (c) => {
                const config = c.resolve<any>(TOKENS.Config);
                return new AIConfigStore(
                    c.resolve(TOKENS.Database),
                    c.resolve(TOKENS.Logger),
                    config.storage.canvas_path
                );
            }
        });

        container.register(AgentOrchestrator, {
            useFactory: (c) => {
                const vaultGet = async (ref: string): Promise<string | undefined> => {
                    try {
                        const vaultStore = c.resolve<any>(TOKENS.VaultStore);
                        const secret = vaultStore.get(ref);
                        return secret?.value;
                    } catch {
                        return undefined;
                    }
                };

                return new AgentOrchestrator(
                    c.resolve(ToolRegistry),
                    c.resolve(AgentSandbox),
                    c.resolve(TOKENS.Logger),
                    c.resolve(AIConfigStore),
                    vaultGet
                );
            }
        });
    },
    init(container: DependencyContainer) {
        const aiConfigStore = container.resolve(AIConfigStore);
        aiConfigStore.migrate();
    }
};

export default config;
