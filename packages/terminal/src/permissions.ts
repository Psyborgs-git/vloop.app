/**
 * Terminal permission and privilege controls.
 *
 * Enforces role-based access, command allowlist/blocklist,
 * and concurrent session limits for terminal access.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TerminalPolicy {
    /** Roles allowed to spawn terminals. */
    allowedRoles: string[];
    /** Maximum concurrent sessions per identity. */
    maxSessionsPerIdentity: number;
    /** Allowed shell executables (if empty, all are allowed). */
    shellAllowlist: string[];
    /** Blocked shell executables (takes precedence over allowlist). */
    shellBlocklist: string[];
    /** Blocked command patterns (regex strings). Checked against input. */
    inputBlockPatterns: string[];
}

export interface AccessCheckResult {
    allowed: boolean;
    reason?: string;
}

// ─── Default Policy ──────────────────────────────────────────────────────────

export const DEFAULT_TERMINAL_POLICY: TerminalPolicy = {
    allowedRoles: ['admin', 'operator'],
    maxSessionsPerIdentity: 5,
    shellAllowlist: [],
    shellBlocklist: [],
    inputBlockPatterns: [
        // Block common destructive patterns (can be customized)
        '^\\s*rm\\s+-rf\\s+/\\s*$',          // rm -rf /
        '^\\s*:(){ :|:& };:',                // fork bomb
        '^\\s*dd\\s+if=/dev/(zero|random)',   // dd wipe
    ],
};

// ─── Access Control Functions ────────────────────────────────────────────────

/**
 * Check if an identity with given roles is allowed to access terminals.
 */
export function checkAccess(
    _identity: string,
    roles: string[],
    currentSessionCount: number,
    policy: TerminalPolicy = DEFAULT_TERMINAL_POLICY,
): AccessCheckResult {
    // Role check
    const hasRole = roles.some((r) => policy.allowedRoles.includes(r));
    if (!hasRole) {
        return {
            allowed: false,
            reason: `Insufficient privileges. Required roles: ${policy.allowedRoles.join(', ')}. Current roles: ${roles.join(', ')}`,
        };
    }

    // Session limit check
    if (currentSessionCount >= policy.maxSessionsPerIdentity) {
        return {
            allowed: false,
            reason: `Session limit reached (${policy.maxSessionsPerIdentity}). Close existing sessions first.`,
        };
    }

    return { allowed: true };
}

/**
 * Validate that a shell executable is permitted by policy.
 */
export function validateShell(
    shell: string,
    policy: TerminalPolicy = DEFAULT_TERMINAL_POLICY,
): AccessCheckResult {
    // Blocklist takes precedence
    if (policy.shellBlocklist.length > 0) {
        const shellBase = shell.split('/').pop() ?? shell;
        if (policy.shellBlocklist.includes(shellBase) || policy.shellBlocklist.includes(shell)) {
            return {
                allowed: false,
                reason: `Shell "${shell}" is blocked by policy.`,
            };
        }
    }

    // Allowlist (if non-empty, shell must be in it)
    if (policy.shellAllowlist.length > 0) {
        const shellBase = shell.split('/').pop() ?? shell;
        const inAllowlist =
            policy.shellAllowlist.includes(shellBase) ||
            policy.shellAllowlist.includes(shell);
        if (!inAllowlist) {
            return {
                allowed: false,
                reason: `Shell "${shell}" is not in the allowlist. Allowed: ${policy.shellAllowlist.join(', ')}`,
            };
        }
    }

    return { allowed: true };
}

// Cache for pre-compiled regular expressions to avoid recompilation overhead.
// Bound size to prevent unbounded memory growth if policies ever become dynamic.
const MAX_REGEX_CACHE_SIZE = 1000;
const inputRegexCache = new Map<string, RegExp>();

/**
 * Check if input text contains blocked patterns.
 * This is a best-effort filter — not a security boundary.
 */
export function validateInput(
    input: string,
    policy: TerminalPolicy = DEFAULT_TERMINAL_POLICY,
): AccessCheckResult {
    for (const pattern of policy.inputBlockPatterns) {
        try {
            let re = inputRegexCache.get(pattern);
            if (!re) {
                // Prevent theoretical memory leak from unbounded dynamic patterns
                if (inputRegexCache.size >= MAX_REGEX_CACHE_SIZE) {
                    inputRegexCache.clear();
                }
                re = new RegExp(pattern);
                inputRegexCache.set(pattern, re);
            }
            if (re.test(input)) {
                return {
                    allowed: false,
                    reason: `Input blocked by policy pattern: ${pattern}`,
                };
            }
        } catch {
            // Invalid regex — skip
        }
    }

    return { allowed: true };
}
