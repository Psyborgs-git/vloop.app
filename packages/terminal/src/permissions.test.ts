import { describe, expect, test } from "bun:test";
import { validateInput, DEFAULT_TERMINAL_POLICY } from "./permissions.ts";

describe("permissions.ts", () => {
    describe("validateInput", () => {
        test("allows normal input", () => {
            const result = validateInput("echo 'hello'");
            expect(result.allowed).toBe(true);
        });

        test("blocks rm -rf /", () => {
            const result = validateInput("rm -rf /");
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("Input blocked by policy pattern:");
        });

        test("blocks fork bomb", () => {
            const result = validateInput(":(){ :|:& };:");
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("Input blocked by policy pattern:");
        });

        test("blocks dd zero to dev", () => {
            const result = validateInput("dd if=/dev/zero of=/dev/sda");
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("Input blocked by policy pattern:");
        });

        test("handles custom policy", () => {
            const customPolicy = {
                ...DEFAULT_TERMINAL_POLICY,
                inputBlockPatterns: ["^\\s*sudo\\s+su\\s*$"]
            };
            const result1 = validateInput("sudo su", customPolicy);
            expect(result1.allowed).toBe(false);

            const result2 = validateInput("echo 'sudo su'", customPolicy);
            expect(result2.allowed).toBe(true);
        });
    });
});
