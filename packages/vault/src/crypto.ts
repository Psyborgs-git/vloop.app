/**
 * Vault cryptographic operations.
 *
 * - Argon2id for master key derivation from passphrase.
 * - AES-256-GCM for secret encryption with per-secret DEKs.
 * - Key wrapping: DEK encrypted with MEK for storage.
 */

import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
} from 'node:crypto';
import argon2 from 'argon2';
import { OrchestratorError, ErrorCode } from '@orch/shared';

// ─── Constants ───────────────────────────────────────────────────────────────

const AES_KEY_LENGTH = 32;    // 256 bits
const GCM_NONCE_LENGTH = 12;  // 96 bits (recommended for GCM)
const GCM_TAG_LENGTH = 16;    // 128 bits
const ALGORITHM = 'aes-256-gcm';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EncryptedData {
    ciphertext: Buffer;
    nonce: Buffer;
    tag: Buffer;
}

export interface WrappedKey {
    wrappedDek: Buffer;
    nonce: Buffer;
    tag: Buffer;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class VaultCrypto {
    private mek: Buffer | null = null;

    /**
     * Derive the Master Encryption Key from a passphrase using Argon2id.
     *
     * @param passphrase - The vault master passphrase.
     * @param salt - The salt (generated on first init, stored in vault_meta).
     */
    async deriveMek(passphrase: string, salt: Buffer): Promise<Buffer> {
        const mek = await argon2.hash(passphrase, {
            salt,
            type: argon2.argon2id,
            memoryCost: 65536,    // 64 MiB
            timeCost: 3,
            parallelism: 4,
            hashLength: AES_KEY_LENGTH,
            raw: true,
        });

        this.mek = Buffer.from(mek);
        return this.mek;
    }

    /**
     * Generate a random salt for Argon2.
     */
    generateSalt(): Buffer {
        return randomBytes(32);
    }

    /**
     * Generate a new random Data Encryption Key.
     */
    generateDek(): Buffer {
        return randomBytes(AES_KEY_LENGTH);
    }

    /**
     * Encrypt plaintext with a key using AES-256-GCM.
     */
    encrypt(plaintext: Buffer, key: Buffer): EncryptedData {
        const nonce = randomBytes(GCM_NONCE_LENGTH);
        const cipher = createCipheriv(ALGORITHM, key, nonce, {
            authTagLength: GCM_TAG_LENGTH,
        });

        const ciphertext = Buffer.concat([
            cipher.update(plaintext),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();

        return { ciphertext, nonce, tag };
    }

    /**
     * Decrypt ciphertext with a key using AES-256-GCM.
     */
    decrypt(encrypted: EncryptedData, key: Buffer): Buffer {
        try {
            const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce, {
                authTagLength: GCM_TAG_LENGTH,
            });
            decipher.setAuthTag(encrypted.tag);

            return Buffer.concat([
                decipher.update(encrypted.ciphertext),
                decipher.final(),
            ]);
        } catch {
            throw new OrchestratorError(
                ErrorCode.VAULT_WRONG_PASSPHRASE,
                'Decryption failed — wrong key or corrupted data.',
            );
        }
    }

    /**
     * Wrap (encrypt) a DEK with the MEK for storage.
     */
    wrapDek(dek: Buffer): WrappedKey {
        if (!this.mek) {
            throw new OrchestratorError(ErrorCode.VAULT_LOCKED, 'Vault is locked. Derive MEK first.');
        }

        const { ciphertext, nonce, tag } = this.encrypt(dek, this.mek);
        return { wrappedDek: ciphertext, nonce, tag };
    }

    /**
     * Unwrap (decrypt) a DEK using the MEK.
     */
    unwrapDek(wrapped: WrappedKey): Buffer {
        if (!this.mek) {
            throw new OrchestratorError(ErrorCode.VAULT_LOCKED, 'Vault is locked. Derive MEK first.');
        }

        return this.decrypt(
            { ciphertext: wrapped.wrappedDek, nonce: wrapped.nonce, tag: wrapped.tag },
            this.mek,
        );
    }

    /**
     * Zero the MEK from memory (on shutdown).
     */
    zeroize(): void {
        if (this.mek) {
            this.mek.fill(0);
            this.mek = null;
        }
    }

    /**
     * Check if the vault is unlocked (MEK in memory).
     */
    isUnlocked(): boolean {
        return this.mek !== null;
    }
}
