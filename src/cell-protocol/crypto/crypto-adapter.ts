/**
 * Cell Protocol - Crypto Adapter
 *
 * TypeScript wrapper around existing OGCrypto module (pwa/js/crypto.js).
 * Provides Ed25519 signing, verification, and key management.
 */

import { PublicKey, Signature, SecretKey, IdentityId } from '../types/common';
import { Result, ok, err, tryCatchAsync } from '../utils/result';

// ============================================
// TYPES
// ============================================

export interface KeyPair {
  publicKey: PublicKey;
  secretKey: SecretKey;
}

export interface CryptoError {
  code: 'KEY_GENERATION_FAILED' | 'SIGNING_FAILED' | 'VERIFICATION_FAILED' | 'NOT_INITIALIZED';
  message: string;
}

// ============================================
// NACL INTERFACE (for browser/node compatibility)
// ============================================

/** Interface for sign.detached which is both a function and has a verify method */
interface SignDetached {
  (message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
}

/** Interface for TweetNaCl library */
interface NaCl {
  sign: {
    keyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
    detached: SignDetached;
  };
  randomBytes(n: number): Uint8Array;
  util?: {
    encodeBase64(bytes: Uint8Array): string;
    decodeBase64(str: string): Uint8Array;
  };
}

// Global nacl reference (set by initialize)
let nacl: NaCl | undefined;

// ============================================
// ENCODING UTILITIES
// ============================================

/**
 * Encode Uint8Array to base64
 */
export function encodeBase64(bytes: Uint8Array): string {
  if (nacl?.util?.encodeBase64) {
    return nacl.util.encodeBase64(bytes);
  }
  // Node.js Buffer fallback
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser fallback
  return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
}

/**
 * Decode base64 to Uint8Array
 */
export function decodeBase64(str: string): Uint8Array {
  if (nacl?.util?.decodeBase64) {
    return nacl.util.decodeBase64(str);
  }
  // Node.js Buffer fallback
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  // Browser fallback
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode Uint8Array to hex string
 */
export function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decode hex string to Uint8Array
 */
export function decodeHex(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length / 2);
  for (let i = 0; i < str.length; i += 2) {
    bytes[i / 2] = parseInt(str.substr(i, 2), 16);
  }
  return bytes;
}

// ============================================
// CRYPTO ADAPTER CLASS
// ============================================

export class CryptoAdapter {
  private initialized = false;

  /**
   * Initialize the crypto adapter with NaCl library
   */
  async initialize(naclInstance?: NaCl): Promise<Result<void, CryptoError>> {
    try {
      if (naclInstance) {
        nacl = naclInstance;
      } else if (typeof globalThis !== 'undefined' && (globalThis as any).nacl) {
        nacl = (globalThis as any).nacl;
      } else {
        // Try to import tweetnacl for Node.js
        try {
          const tweetnacl = await import('tweetnacl');
          nacl = tweetnacl.default || tweetnacl;
        } catch {
          return err({
            code: 'NOT_INITIALIZED',
            message: 'TweetNaCl not available. Please provide naclInstance or install tweetnacl.',
          });
        }
      }
      this.initialized = true;
      return ok(undefined);
    } catch (e) {
      return err({
        code: 'NOT_INITIALIZED',
        message: `Failed to initialize crypto: ${e}`,
      });
    }
  }

  /**
   * Check if adapter is initialized
   */
  isInitialized(): boolean {
    return this.initialized && nacl !== undefined;
  }

  /**
   * Generate a new Ed25519 keypair
   */
  generateKeyPair(): Result<KeyPair, CryptoError> {
    if (!this.isInitialized() || !nacl) {
      return err({ code: 'NOT_INITIALIZED', message: 'Crypto not initialized' });
    }

    try {
      const keypair = nacl.sign.keyPair();
      return ok({
        publicKey: encodeBase64(keypair.publicKey),
        secretKey: encodeBase64(keypair.secretKey),
      });
    } catch (e) {
      return err({
        code: 'KEY_GENERATION_FAILED',
        message: `Key generation failed: ${e}`,
      });
    }
  }

  /**
   * Derive identity ID from public key
   * Uses first 16 bytes of public key as hex string
   */
  deriveIdentityId(publicKey: PublicKey): IdentityId {
    const bytes = decodeBase64(publicKey);
    return encodeHex(bytes.slice(0, 16));
  }

  /**
   * Sign a message with a secret key
   */
  sign(message: string | object, secretKey: SecretKey): Result<Signature, CryptoError> {
    if (!this.isInitialized() || !nacl) {
      return err({ code: 'NOT_INITIALIZED', message: 'Crypto not initialized' });
    }

    try {
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      const messageBytes = new TextEncoder().encode(messageStr);
      const secretKeyBytes = decodeBase64(secretKey);

      const signature = nacl.sign.detached(messageBytes, secretKeyBytes);
      return ok(encodeBase64(signature));
    } catch (e) {
      return err({
        code: 'SIGNING_FAILED',
        message: `Signing failed: ${e}`,
      });
    }
  }

  /**
   * Verify a signature
   */
  verify(message: string | object, signature: Signature, publicKey: PublicKey): boolean {
    if (!this.isInitialized() || !nacl) {
      return false;
    }

    try {
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      const messageBytes = new TextEncoder().encode(messageStr);
      const signatureBytes = decodeBase64(signature);
      const publicKeyBytes = decodeBase64(publicKey);

      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch {
      return false;
    }
  }

  /**
   * Generate a random nonce (hex string)
   */
  generateNonce(byteLength: number = 16): string {
    if (!this.isInitialized() || !nacl) {
      // Fallback to Math.random for nonce generation
      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < byteLength; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
      return encodeHex(bytes);
    }

    const bytes = nacl.randomBytes(byteLength);
    return encodeHex(bytes);
  }

  /**
   * Generate a random ID
   */
  generateId(): string {
    const timestamp = Date.now().toString(36);
    const nonce = this.generateNonce(8);
    return `${timestamp}-${nonce}`;
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

/** Default crypto adapter instance */
export const cryptoAdapter = new CryptoAdapter();

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Create canonical signing data for a transaction
 */
export function createTransactionSigningData(data: {
  payer: IdentityId;
  payee: IdentityId;
  amount: number;
  description: string;
  createdAt: number;
  nonce: string;
}): string {
  return JSON.stringify({
    payer: data.payer,
    payee: data.payee,
    amount: data.amount,
    description: data.description,
    createdAt: data.createdAt,
    nonce: data.nonce,
  });
}

/**
 * Sign transaction data
 */
export function signTransaction(
  data: {
    payer: IdentityId;
    payee: IdentityId;
    amount: number;
    description: string;
    createdAt: number;
    nonce: string;
  },
  secretKey: SecretKey
): Result<Signature, CryptoError> {
  const message = createTransactionSigningData(data);
  return cryptoAdapter.sign(message, secretKey);
}

/**
 * Verify transaction signature
 */
export function verifyTransactionSignature(
  data: {
    payer: IdentityId;
    payee: IdentityId;
    amount: number;
    description: string;
    createdAt: number;
    nonce: string;
  },
  signature: Signature,
  publicKey: PublicKey
): boolean {
  const message = createTransactionSigningData(data);
  return cryptoAdapter.verify(message, signature, publicKey);
}
