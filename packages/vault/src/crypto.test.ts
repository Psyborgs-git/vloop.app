/**
 * Tests for @orch/vault/crypto — AES-256-GCM and Argon2id
 */

import { describe, it, expect } from 'vitest';
import { VaultCrypto } from './crypto.js';

describe('VaultCrypto', () => {
    it('should generate a random salt (32 bytes)', () => {
        const crypto = new VaultCrypto();
        const salt = crypto.generateSalt();
        expect(salt).toBeInstanceOf(Buffer);
        expect(salt.length).toBe(32);
    });

    it('should generate a random DEK (32 bytes)', () => {
        const crypto = new VaultCrypto();
        const dek = crypto.generateDek();
        expect(dek).toBeInstanceOf(Buffer);
        expect(dek.length).toBe(32);
    });

    it('should generate unique DEKs', () => {
        const crypto = new VaultCrypto();
        const dek1 = crypto.generateDek();
        const dek2 = crypto.generateDek();
        expect(dek1.equals(dek2)).toBe(false);
    });

    it('should encrypt and decrypt round-trip', () => {
        const crypto = new VaultCrypto();
        const key = crypto.generateDek();
        const plaintext = Buffer.from('Hello, Orchestrator!');

        const encrypted = crypto.encrypt(plaintext, key);
        expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
        expect(encrypted.nonce).toBeInstanceOf(Buffer);
        expect(encrypted.tag).toBeInstanceOf(Buffer);
        expect(encrypted.nonce.length).toBe(12);
        expect(encrypted.tag.length).toBe(16);

        // Ciphertext should differ from plaintext
        expect(encrypted.ciphertext.equals(plaintext)).toBe(false);

        const decrypted = crypto.decrypt(encrypted, key);
        expect(decrypted.toString('utf-8')).toBe('Hello, Orchestrator!');
    });

    it('should fail to decrypt with wrong key', () => {
        const crypto = new VaultCrypto();
        const key1 = crypto.generateDek();
        const key2 = crypto.generateDek();

        const encrypted = crypto.encrypt(Buffer.from('secret'), key1);
        expect(() => crypto.decrypt(encrypted, key2)).toThrow();
    });

    it('should derive MEK from passphrase via Argon2id', async () => {
        const crypto = new VaultCrypto();
        const salt = crypto.generateSalt();

        expect(crypto.isUnlocked()).toBe(false);
        const mek = await crypto.deriveMek('test-passphrase', salt);

        expect(mek).toBeInstanceOf(Buffer);
        expect(mek.length).toBe(32);
        expect(crypto.isUnlocked()).toBe(true);
    });

    it('should wrap and unwrap a DEK', async () => {
        const crypto = new VaultCrypto();
        const salt = crypto.generateSalt();
        await crypto.deriveMek('test-passphrase', salt);

        const dek = crypto.generateDek();
        const wrapped = crypto.wrapDek(dek);

        expect(wrapped.wrappedDek).toBeInstanceOf(Buffer);
        expect(wrapped.wrappedDek.equals(dek)).toBe(false); // Should be encrypted

        const unwrapped = crypto.unwrapDek(wrapped);
        expect(unwrapped.equals(dek)).toBe(true);
    });

    it('should throw when wrapping without MEK', () => {
        const crypto = new VaultCrypto();
        const dek = crypto.generateDek();
        expect(() => crypto.wrapDek(dek)).toThrow('Vault is locked');
    });

    it('should zeroize MEK from memory', async () => {
        const crypto = new VaultCrypto();
        const salt = crypto.generateSalt();
        await crypto.deriveMek('test-passphrase', salt);

        expect(crypto.isUnlocked()).toBe(true);
        crypto.zeroize();
        expect(crypto.isUnlocked()).toBe(false);

        // Should fail to wrap after zeroize
        const dek = crypto.generateDek();
        expect(() => crypto.wrapDek(dek)).toThrow('Vault is locked');
    });

    it('should produce deterministic MEK for same passphrase + salt', async () => {
        const crypto1 = new VaultCrypto();
        const crypto2 = new VaultCrypto();
        const salt = crypto1.generateSalt();

        const mek1 = await crypto1.deriveMek('same-pass', salt);
        const mek2 = await crypto2.deriveMek('same-pass', salt);

        expect(mek1.equals(mek2)).toBe(true);
    });

    it('should produce different MEK for different passphrase', async () => {
        const crypto1 = new VaultCrypto();
        const crypto2 = new VaultCrypto();
        const salt = crypto1.generateSalt();

        const mek1 = await crypto1.deriveMek('pass-a', salt);
        const mek2 = await crypto2.deriveMek('pass-b', salt);

        expect(mek1.equals(mek2)).toBe(false);
    });
});
