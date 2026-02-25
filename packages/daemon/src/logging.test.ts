import { describe, it, expect } from 'vitest';
import { createLogger } from './logging.js';

// we only check that the returned object is a pino logger and that the
// transport option toggles when the environment variable is set. pino's own
// internals are not worth dragging into our tests.

describe('createLogger', () => {
    it('returns a usable logger with the requested level', () => {
        const logger = createLogger('info');
        expect(logger).toHaveProperty('info');
        // level is exposed as the string on newer pino versions
        expect(logger.level).toBe('info');
    });

    it('does not crash when PINO_PRETTY is set', () => {
        process.env.PINO_PRETTY = '1';
        expect(() => createLogger('debug')).not.toThrow();
        delete process.env.PINO_PRETTY;
    });
});
