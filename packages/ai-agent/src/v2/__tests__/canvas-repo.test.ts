/**
 * Canvas repo tests — CRUD, commit history, and rollback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { AiAgentOrm } from '../orm-type.js';
import { createTestDb } from './test-db.js';
import { CanvasRepo } from '../repos/canvas-repo.js';

let db: InstanceType<typeof Database>;
let orm: AiAgentOrm;
let repo: CanvasRepo;

beforeEach(() => {
	const ctx = createTestDb();
	db = ctx.db;
	orm = ctx.orm;
	repo = new CanvasRepo(orm);
});
afterEach(() => db.close());

describe('CanvasRepo', () => {
	it('creates a canvas', () => {
		const c = repo.create({ name: 'My Canvas', owner: 'user-1' });
		expect(c.id).toBeDefined();
		expect(c.name).toBe('My Canvas');
		expect(c.owner).toBe('user-1');
		expect(c.content).toBe('');
	});

	it('gets by id', () => {
		const c = repo.create({ name: 'Test', owner: 'user-1' });
		const got = repo.get(c.id);
		expect(got).toBeDefined();
		expect(got!.id).toBe(c.id);
	});

	it('returns undefined for missing id', () => {
		expect(repo.get('nonexistent')).toBeUndefined();
	});

	it('lists canvases', () => {
		repo.create({ name: 'Canvas A', owner: 'user-1' });
		repo.create({ name: 'Canvas B', owner: 'user-2' });
		expect(repo.listCanvases()).toHaveLength(2);
	});

	it('lists canvases filtered by owner', () => {
		repo.create({ name: 'A', owner: 'alice' });
		repo.create({ name: 'B', owner: 'bob' });
		repo.create({ name: 'C', owner: 'alice' });
		expect(repo.listCanvases('alice')).toHaveLength(2);
		expect(repo.listCanvases('bob')).toHaveLength(1);
	});

	it('updates canvas metadata', () => {
		const c = repo.create({ name: 'Test', owner: 'user-1' });
		const updated = repo.update(c.id, { name: 'Renamed', description: 'desc' });
		expect(updated.name).toBe('Renamed');
		expect(updated.description).toBe('desc');
	});

	it('creates a commit when content changes', () => {
		const c = repo.create({ name: 'Test', owner: 'user-1', content: 'original' });
		repo.update(c.id, { content: 'modified' });

		const commits = repo.listCanvasCommits(c.id);
		expect(commits).toHaveLength(1);
		expect(commits[0].content).toBe('original');
	});

	it('does not create commit when content unchanged', () => {
		const c = repo.create({ name: 'Test', owner: 'user-1', content: 'same' });
		repo.update(c.id, { name: 'Renamed' }); // name-only change

		const commits = repo.listCanvasCommits(c.id);
		expect(commits).toHaveLength(0);
	});

	it('rollbacks canvas to a previous commit', () => {
		const c = repo.create({ name: 'Test', owner: 'user-1', content: 'v1' });
		repo.update(c.id, { content: 'v2' });
		const commits = repo.listCanvasCommits(c.id);
		expect(commits).toHaveLength(1); // v1 is committed

		const rolled = repo.rollbackCanvas(c.id, commits[0].id, 'admin');
		expect(rolled.content).toBe('v1');
	});

	it('deletes canvas and cascades commits', () => {
		const c = repo.create({ name: 'Test', owner: 'user-1', content: 'v1' });
		repo.update(c.id, { content: 'v2' });
		expect(repo.listCanvasCommits(c.id)).toHaveLength(1);

		repo.delete(c.id);
		expect(repo.get(c.id)).toBeUndefined();
		expect(repo.listCanvasCommits(c.id)).toHaveLength(0);
	});

	it('throws on update of nonexistent canvas', () => {
		expect(() => repo.update('nope', { name: 'X' })).toThrow('Canvas not found: nope');
	});

	it('throws on rollback of nonexistent commit', () => {
		const c = repo.create({ name: 'T', owner: 'u' });
		expect(() => repo.rollbackCanvas(c.id, 'bad-commit', 'u')).toThrow('Canvas commit not found: bad-commit');
	});
});
