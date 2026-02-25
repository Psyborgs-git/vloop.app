import { Gemini } from '@google/adk';
import { activeRuntimes } from './provider-registry.js';

export class GoogleLlm extends Gemini {
    static readonly supportedModels = ['vloop://google/.*'];

    constructor(params: { model: string }) {
        const runtime = activeRuntimes.get(params.model);
        if (!runtime) {
            throw new Error(`GoogleLlm requires a ResolvedModel runtime for ${params.model}`);
        }
        
        super({
            model: runtime.model.modelId,
            apiKey: runtime.apiKey,
            headers: runtime.headers,
        });
    }
}
