/**
 * OpenGoban Cryptography Module
 *
 * Provides Ed25519 key generation, signing, and verification
 * using TweetNaCl.js (audited, pure JavaScript implementation)
 */

const OGCrypto = (function() {
  'use strict';

  // Key storage database name
  const KEY_STORE_NAME = 'og_keystore';
  const KEY_STORE_VERSION = 1;

  // ========================================
  // KEY STORAGE (IndexedDB)
  // ========================================

  /**
   * Open the key storage database
   */
  function openKeyStore() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(KEY_STORE_NAME, KEY_STORE_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open key store: ' + request.error));
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys');
        }
      };
    });
  }

  /**
   * Store a value in the key store
   */
  async function storeKey(key, value) {
    const db = await openKeyStore();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      const request = store.put(value, key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();

      tx.oncomplete = () => db.close();
    });
  }

  /**
   * Retrieve a value from the key store
   */
  async function getKey(key) {
    const db = await openKeyStore();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readonly');
      const store = tx.objectStore('keys');
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      tx.oncomplete = () => db.close();
    });
  }

  /**
   * Delete a value from the key store
   */
  async function deleteKey(key) {
    const db = await openKeyStore();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();

      tx.oncomplete = () => db.close();
    });
  }

  // ========================================
  // KEY GENERATION
  // ========================================

  /**
   * Generate a new Ed25519 keypair
   * Returns { publicKey: Uint8Array, secretKey: Uint8Array }
   */
  function generateKeypair() {
    if (typeof nacl === 'undefined') {
      throw new Error('TweetNaCl not loaded');
    }
    return nacl.sign.keyPair();
  }

  /**
   * Generate and store a new identity
   * Returns the public key as base64 string (this becomes the member ID)
   */
  async function createIdentity() {
    const keypair = generateKeypair();

    // Store keys in IndexedDB
    await storeKey('secretKey', keypair.secretKey);
    await storeKey('publicKey', keypair.publicKey);

    // Return public key as base64 (this is the member's identity)
    return encodeBase64(keypair.publicKey);
  }

  /**
   * Check if an identity exists
   */
  async function hasIdentity() {
    const secretKey = await getKey('secretKey');
    return secretKey !== undefined;
  }

  /**
   * Get the current public key as base64
   */
  async function getPublicKey() {
    const publicKey = await getKey('publicKey');
    if (!publicKey) {
      throw new Error('No identity found');
    }
    return encodeBase64(publicKey);
  }

  /**
   * Get the raw secret key (for signing)
   */
  async function getSecretKey() {
    const secretKey = await getKey('secretKey');
    if (!secretKey) {
      throw new Error('No identity found');
    }
    return secretKey;
  }

  /**
   * Delete the current identity (use with caution!)
   */
  async function deleteIdentity() {
    await deleteKey('secretKey');
    await deleteKey('publicKey');
  }

  // ========================================
  // SIGNING & VERIFICATION
  // ========================================

  /**
   * Sign a message with the stored secret key
   * @param {string|object} message - The message to sign (will be JSON stringified if object)
   * @returns {string} Base64-encoded signature
   */
  async function sign(message) {
    const secretKey = await getSecretKey();

    // Convert message to string if needed
    const messageStr = typeof message === 'string'
      ? message
      : JSON.stringify(message);

    // Encode to bytes
    const messageBytes = new TextEncoder().encode(messageStr);

    // Sign with Ed25519 (detached signature)
    const signature = nacl.sign.detached(messageBytes, secretKey);

    return encodeBase64(signature);
  }

  /**
   * Verify a signature
   * @param {string|object} message - The original message
   * @param {string} signature - Base64-encoded signature
   * @param {string} publicKey - Base64-encoded public key
   * @returns {boolean} True if signature is valid
   */
  function verify(message, signature, publicKey) {
    try {
      // Convert message to string if needed
      const messageStr = typeof message === 'string'
        ? message
        : JSON.stringify(message);

      // Decode from base64
      const messageBytes = new TextEncoder().encode(messageStr);
      const signatureBytes = decodeBase64(signature);
      const publicKeyBytes = decodeBase64(publicKey);

      // Verify with Ed25519
      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch (err) {
      console.error('Signature verification error:', err);
      return false;
    }
  }

  // ========================================
  // TRANSACTION SIGNING
  // ========================================

  /**
   * Create a canonical message for transaction signing
   * This ensures both parties sign the exact same data
   */
  function canonicalTransactionMessage(tx) {
    return JSON.stringify({
      sender_id: tx.sender_id,
      recipient_id: tx.recipient_id,
      amount: tx.amount,
      description: tx.description,
      created_at: tx.created_at,
      nonce: tx.nonce
    });
  }

  /**
   * Sign a transaction as sender
   */
  async function signTransactionAsSender(tx) {
    const message = canonicalTransactionMessage(tx);
    return await sign(message);
  }

  /**
   * Sign a transaction as recipient (confirmation)
   */
  async function signTransactionAsRecipient(tx) {
    const message = canonicalTransactionMessage(tx);
    return await sign(message);
  }

  /**
   * Verify a transaction signature
   */
  function verifyTransactionSignature(tx, signature, signerPublicKey) {
    const message = canonicalTransactionMessage(tx);
    return verify(message, signature, signerPublicKey);
  }

  // ========================================
  // ENCODING UTILITIES
  // ========================================

  /**
   * Encode Uint8Array to base64
   */
  function encodeBase64(bytes) {
    if (typeof nacl !== 'undefined' && nacl.util && nacl.util.encodeBase64) {
      return nacl.util.encodeBase64(bytes);
    }
    // Fallback to browser btoa
    return btoa(String.fromCharCode.apply(null, bytes));
  }

  /**
   * Decode base64 to Uint8Array
   */
  function decodeBase64(str) {
    if (typeof nacl !== 'undefined' && nacl.util && nacl.util.decodeBase64) {
      return nacl.util.decodeBase64(str);
    }
    // Fallback to browser atob
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
  function encodeHex(bytes) {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Decode hex string to Uint8Array
   */
  function decodeHex(str) {
    const bytes = new Uint8Array(str.length / 2);
    for (let i = 0; i < str.length; i += 2) {
      bytes[i / 2] = parseInt(str.substr(i, 2), 16);
    }
    return bytes;
  }

  /**
   * Generate a random nonce (for transaction uniqueness)
   */
  function generateNonce() {
    const bytes = nacl.randomBytes(16);
    return encodeHex(bytes);
  }

  /**
   * Generate a short random ID
   */
  function generateId() {
    const bytes = nacl.randomBytes(8);
    return encodeHex(bytes);
  }

  // ========================================
  // PUBLIC API
  // ========================================

  return {
    // Identity management
    createIdentity,
    hasIdentity,
    getPublicKey,
    deleteIdentity,

    // Signing
    sign,
    verify,

    // Transaction-specific
    signTransactionAsSender,
    signTransactionAsRecipient,
    verifyTransactionSignature,
    canonicalTransactionMessage,

    // Utilities
    encodeBase64,
    decodeBase64,
    encodeHex,
    decodeHex,
    generateNonce,
    generateId
  };
})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OGCrypto;
}
