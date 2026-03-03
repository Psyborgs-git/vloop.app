/**
 * Agent Handler — topic handler for all AI config CRUD + execution actions.
 *
 * Registered on the "agent" topic. Actions are namespaced:
 *   agent.provider.* | agent.model.* | agent.tool.* | agent.config.*
 *   agent.workflow.* | agent.chat.* | agent.memory.* | agent.run.*
 *
 * Delegates to v2 handler implementation.
 */

export { createAgentHandlerV2 as createAgentHandler } from './v2/handler.js';

