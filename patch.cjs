const fs = require('fs');
const path = 'packages/ai-agent/src/orchestrator.ts';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
    /if \(emit\) \{\n\s+const mappedEvent: any = \{ \.\.\.event \};\n\s+if \(chunkText\) mappedEvent\.text = chunkText;\n\s+if \(chunkToolCalls\.length > 0\) mappedEvent\.toolCalls = chunkToolCalls;\n\s+if \(chunkToolResults\.length > 0\)\n\s+mappedEvent\.toolResult = chunkToolResults\[0\]; \/\/ ChatView expects single toolResult\n\s+emit\("stream", mappedEvent, seq\+\+\);\n\s+\}/,
    `if (emit) {
                                const mappedEvent: any = { ...event };
                                if (chunkText) mappedEvent.text = chunkText;
                                if (chunkToolCalls.length > 0) mappedEvent.toolCalls = chunkToolCalls;
                                if (chunkToolResults.length > 0)
                                        mappedEvent.toolResult = chunkToolResults[0]; // ChatView expects single toolResult
                                if (event.actions?.requestedToolConfirmations && Object.keys(event.actions.requestedToolConfirmations).length > 0) {
                                        mappedEvent.requestedToolConfirmations = event.actions.requestedToolConfirmations;
                                }
                                if (event.longRunningToolIds && event.longRunningToolIds.length > 0) {
                                        mappedEvent.longRunningToolIds = event.longRunningToolIds;
                                }
                                emit("stream", mappedEvent, seq++);
                        }`
);
fs.writeFileSync(path, content);
