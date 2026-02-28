
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { TerminalProfileManager, CreateProfileInput, UpdateProfileInput } from './profiles.js';

// Helper to create a logger stub
function createLoggerStub() {
    const base = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };
    return {
        ...base,
        child: vi.fn(() => base),
    } as any;
}

describe('TerminalProfileManager', () => {
    let db: ReturnType<typeof Database>;
    let manager: TerminalProfileManager;
    let logger: ReturnType<typeof createLoggerStub>;

    beforeEach(() => {
        db = new Database(':memory:');
        logger = createLoggerStub();
        manager = new TerminalProfileManager(db, logger);
    });

    it('creates a profile', () => {
        const input: CreateProfileInput = {
            name: 'test-profile',
            owner: 'user1',
            shell: '/bin/bash',
            cwd: '/home/user1',
        };

        const profile = manager.create(input);

        expect(profile).toBeDefined();
        expect(profile.id).toMatch(/^tp_/);
        expect(profile.name).toBe(input.name);
        expect(profile.owner).toBe(input.owner);
        expect(profile.shell).toBe(input.shell);
        expect(profile.cwd).toBe(input.cwd);
        expect(profile.createdAt).toBeDefined();
        expect(profile.updatedAt).toBeDefined();
    });

    it('gets a profile by ID', () => {
        const input: CreateProfileInput = {
            name: 'test-profile',
            owner: 'user1',
        };
        const created = manager.create(input);
        const retrieved = manager.get(created.id);

        expect(retrieved).toEqual(created);
    });

    it('returns undefined for non-existent profile ID', () => {
        const retrieved = manager.get('non-existent-id');
        expect(retrieved).toBeUndefined();
    });

    it('lists profiles', () => {
        manager.create({ name: 'p1', owner: 'user1' });
        manager.create({ name: 'p2', owner: 'user1' });
        manager.create({ name: 'p3', owner: 'user2' });

        const allProfiles = manager.list();
        expect(allProfiles).toHaveLength(3);

        const user1Profiles = manager.list('user1');
        expect(user1Profiles).toHaveLength(2);
        expect(user1Profiles.map(p => p.name)).toEqual(expect.arrayContaining(['p1', 'p2']));

        const user2Profiles = manager.list('user2');
        expect(user2Profiles).toHaveLength(1);
        expect(user2Profiles[0].name).toBe('p3');
    });

    it('manages default profiles correctly', () => {
        // Create first profile as default
        const p1 = manager.create({ name: 'p1', owner: 'user1', isDefault: true });
        expect(p1.isDefault).toBe(true);

        let defaultProfile = manager.getDefault('user1');
        expect(defaultProfile?.id).toBe(p1.id);

        // Create second profile as default, should unset first one
        const p2 = manager.create({ name: 'p2', owner: 'user1', isDefault: true });
        expect(p2.isDefault).toBe(true);

        defaultProfile = manager.getDefault('user1');
        expect(defaultProfile?.id).toBe(p2.id);

        // Verify p1 is no longer default
        const p1Updated = manager.get(p1.id);
        expect(p1Updated?.isDefault).toBe(false);

        // Create third profile NOT as default
        const p3 = manager.create({ name: 'p3', owner: 'user1', isDefault: false });
        expect(p3.isDefault).toBe(false);

        // Default should still be p2
        defaultProfile = manager.getDefault('user1');
        expect(defaultProfile?.id).toBe(p2.id);
    });

    it('updates a profile', async () => {
        const created = manager.create({ name: 'old', owner: 'user1' });

        await new Promise((r) => setTimeout(r, 2));

        const updateInput: UpdateProfileInput = {
            name: 'updated',
            shell: 'bash',
        };

        const updated = manager.update(created.id, updateInput);

        expect(updated).toBeDefined();
        expect(updated?.name).toBe('updated');
        expect(updated?.shell).toBe('bash');
        expect(updated?.owner).toBe('user1'); // Owner should not change
        expect(updated?.updatedAt).not.toBe(created.updatedAt);
    });

    it('updates default status correctly', () => {
        const p1 = manager.create({ name: 'p1', owner: 'user1', isDefault: true });
        const p2 = manager.create({ name: 'p2', owner: 'user1', isDefault: false });

        // Update p2 to be default
        manager.update(p2.id, { isDefault: true });

        const p1Updated = manager.get(p1.id);
        const p2Updated = manager.get(p2.id);

        expect(p1Updated?.isDefault).toBe(false);
        expect(p2Updated?.isDefault).toBe(true);
    });

    it('returns undefined when updating non-existent profile', () => {
        const result = manager.update('non-existent', { name: 'foo' });
        expect(result).toBeUndefined();
    });

    it('deletes a profile', () => {
        const created = manager.create({ name: 'to-delete', owner: 'user1' });

        const result = manager.delete(created.id);
        expect(result).toBe(true);

        const retrieved = manager.get(created.id);
        expect(retrieved).toBeUndefined();
    });

    it('returns false when deleting non-existent profile', () => {
        const result = manager.delete('non-existent');
        expect(result).toBe(false);
    });
});
