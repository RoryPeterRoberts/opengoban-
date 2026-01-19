/**
 * Cell Protocol - Transaction Engine Tests
 *
 * Tests for the Transaction System (PRD-02).
 * Verifies transaction validation, signing, and execution.
 */

import {
  TransactionEngine,
  TransactionValidationError,
  createTransactionEngine,
} from '../engines/transaction-engine';
import {
  LedgerEngine,
  createLedgerEngine,
} from '../engines/ledger-engine';
import { createInMemoryStorage, InMemoryStorage } from '../storage/pouchdb-adapter';
import { CryptoAdapter } from '../crypto/crypto-adapter';
import { TransactionErrorCode, TransactionStatus } from '../types/transaction';
import { MembershipStatus } from '../types/common';

describe('TransactionEngine', () => {
  let storage: InMemoryStorage;
  let ledger: LedgerEngine;
  let crypto: CryptoAdapter;
  let transactions: TransactionEngine;

  // Store keypairs for testing
  const keypairs: Map<string, { publicKey: string; secretKey: string }> = new Map();

  // Public key resolver
  const publicKeyResolver = async (memberId: string): Promise<string | undefined> => {
    return keypairs.get(memberId)?.publicKey;
  };

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledger = await createLedgerEngine('test-cell', { defaultLimit: 100 }, storage);
    crypto = new CryptoAdapter();
    await crypto.initialize();

    transactions = createTransactionEngine(ledger, storage, crypto, publicKeyResolver);

    // Create members with keypairs
    const aliceKeys = crypto.generateKeyPair();
    const bobKeys = crypto.generateKeyPair();
    const charlieKeys = crypto.generateKeyPair();

    if (aliceKeys.ok && bobKeys.ok && charlieKeys.ok) {
      keypairs.set('alice', aliceKeys.value);
      keypairs.set('bob', bobKeys.value);
      keypairs.set('charlie', charlieKeys.value);
    }

    // Add members to ledger
    await ledger.addMember('alice', 100);
    await ledger.addMember('bob', 100);
    await ledger.addMember('charlie', 100);
  });

  describe('Transaction Creation', () => {
    test('creates a valid spot transaction', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      expect(tx.payer).toBe('alice');
      expect(tx.payee).toBe('bob');
      expect(tx.amount).toBe(50);
      expect(tx.description).toBe('Test payment');
      expect(tx.status).toBe(TransactionStatus.PENDING);
      expect(tx.signatures.payer).toBeUndefined();
      expect(tx.signatures.payee).toBeUndefined();
    });

    test('TX-07: self-payment fails with SELF_TRANSACTION', async () => {
      await expect(
        transactions.createSpotTransaction({
          payer: 'alice',
          payee: 'alice',
          amount: 50,
          description: 'Self payment',
        })
      ).rejects.toThrow(TransactionValidationError);

      try {
        await transactions.createSpotTransaction({
          payer: 'alice',
          payee: 'alice',
          amount: 50,
          description: 'Self payment',
        });
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.SELF_TRANSACTION);
      }
    });

    test('rejects zero amount', async () => {
      await expect(
        transactions.createSpotTransaction({
          payer: 'alice',
          payee: 'bob',
          amount: 0,
          description: 'Zero payment',
        })
      ).rejects.toThrow(TransactionValidationError);

      try {
        await transactions.createSpotTransaction({
          payer: 'alice',
          payee: 'bob',
          amount: 0,
          description: 'Zero payment',
        });
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.INVALID_AMOUNT);
      }
    });

    test('rejects negative amount', async () => {
      try {
        await transactions.createSpotTransaction({
          payer: 'alice',
          payee: 'bob',
          amount: -10,
          description: 'Negative payment',
        });
        fail('Expected INVALID_AMOUNT error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.INVALID_AMOUNT);
      }
    });

    test('rejects non-member payer', async () => {
      try {
        await transactions.createSpotTransaction({
          payer: 'nobody',
          payee: 'bob',
          amount: 50,
          description: 'Payment from non-member',
        });
        fail('Expected PAYER_NOT_MEMBER error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.PAYER_NOT_MEMBER);
      }
    });

    test('rejects non-member payee', async () => {
      try {
        await transactions.createSpotTransaction({
          payer: 'alice',
          payee: 'nobody',
          amount: 50,
          description: 'Payment to non-member',
        });
        fail('Expected PAYEE_NOT_MEMBER error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.PAYEE_NOT_MEMBER);
      }
    });

    test('TX-02: payer at floor fails with INSUFFICIENT_CAPACITY', async () => {
      // Put alice at her floor
      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -100, reason: 'SPOT_TRANSACTION_PAYER' as any },
        { memberId: 'bob', delta: +100, reason: 'SPOT_TRANSACTION_PAYEE' as any },
      ]);

      try {
        await transactions.createSpotTransaction({
          payer: 'alice',
          payee: 'charlie',
          amount: 1,
          description: 'Payment when at floor',
        });
        fail('Expected INSUFFICIENT_CAPACITY error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.INSUFFICIENT_CAPACITY);
      }
    });

    test('rejects frozen payer', async () => {
      await ledger.updateMemberStatus('alice', MembershipStatus.FROZEN);

      try {
        await transactions.createSpotTransaction({
          payer: 'alice',
          payee: 'bob',
          amount: 50,
          description: 'Payment from frozen member',
        });
        fail('Expected PAYER_NOT_MEMBER error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.PAYER_NOT_MEMBER);
      }
    });
  });

  describe('Transaction Signing', () => {
    test('adds payer signature', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      const signingData = transactions.getSigningData(tx);
      const signResult = crypto.sign(JSON.stringify(signingData), keypairs.get('alice')!.secretKey);
      expect(signResult.ok).toBe(true);

      const signedTx = await transactions.signAsPayer(tx.id, signResult.ok ? signResult.value : '');

      expect(signedTx.signatures.payer).toBeDefined();
      expect(signedTx.status).toBe(TransactionStatus.PENDING);
    });

    test('adds payee signature', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      const signingData = transactions.getSigningData(tx);
      const signResult = crypto.sign(JSON.stringify(signingData), keypairs.get('bob')!.secretKey);
      expect(signResult.ok).toBe(true);

      const signedTx = await transactions.signAsPayee(tx.id, signResult.ok ? signResult.value : '');

      expect(signedTx.signatures.payee).toBeDefined();
      expect(signedTx.status).toBe(TransactionStatus.PENDING);
    });

    test('transaction becomes READY when both signatures present', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      const signingData = transactions.getSigningData(tx);

      // Sign as payer
      const payerSig = crypto.sign(JSON.stringify(signingData), keypairs.get('alice')!.secretKey);
      await transactions.signAsPayer(tx.id, payerSig.ok ? payerSig.value : '');

      // Sign as payee
      const payeeSig = crypto.sign(JSON.stringify(signingData), keypairs.get('bob')!.secretKey);
      const signedTx = await transactions.signAsPayee(tx.id, payeeSig.ok ? payeeSig.value : '');

      expect(signedTx.status).toBe(TransactionStatus.READY);
    });

    test('rejects invalid payer signature', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      // Sign with bob's key (wrong key for payer)
      const signingData = transactions.getSigningData(tx);
      const wrongSig = crypto.sign(JSON.stringify(signingData), keypairs.get('bob')!.secretKey);

      try {
        await transactions.signAsPayer(tx.id, wrongSig.ok ? wrongSig.value : '');
        fail('Expected INVALID_PAYER_SIGNATURE error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.INVALID_PAYER_SIGNATURE);
      }
    });

    test('rejects invalid payee signature', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      // Sign with alice's key (wrong key for payee)
      const signingData = transactions.getSigningData(tx);
      const wrongSig = crypto.sign(JSON.stringify(signingData), keypairs.get('alice')!.secretKey);

      try {
        await transactions.signAsPayee(tx.id, wrongSig.ok ? wrongSig.value : '');
        fail('Expected INVALID_PAYEE_SIGNATURE error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.INVALID_PAYEE_SIGNATURE);
      }
    });
  });

  describe('Transaction Execution', () => {
    test('TX-01: valid transaction execution', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      const signingData = transactions.getSigningData(tx);

      // Sign as both parties
      const payerSig = crypto.sign(JSON.stringify(signingData), keypairs.get('alice')!.secretKey);
      await transactions.signAsPayer(tx.id, payerSig.ok ? payerSig.value : '');

      const payeeSig = crypto.sign(JSON.stringify(signingData), keypairs.get('bob')!.secretKey);
      await transactions.signAsPayee(tx.id, payeeSig.ok ? payeeSig.value : '');

      // Execute
      const result = await transactions.executeTransaction(tx.id);

      expect(result.transaction.status).toBe(TransactionStatus.EXECUTED);
      expect(result.payerNewBalance).toBe(-50);
      expect(result.payeeNewBalance).toBe(50);

      // Verify ledger state
      expect(ledger.getMemberState('alice')?.balance).toBe(-50);
      expect(ledger.getMemberState('bob')?.balance).toBe(50);
      expect(ledger.verifyConservation()).toBe(true);
    });

    test('fails execution without payer signature', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      const signingData = transactions.getSigningData(tx);
      const payeeSig = crypto.sign(JSON.stringify(signingData), keypairs.get('bob')!.secretKey);
      await transactions.signAsPayee(tx.id, payeeSig.ok ? payeeSig.value : '');

      try {
        await transactions.executeTransaction(tx.id);
        fail('Expected INVALID_PAYER_SIGNATURE error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.INVALID_PAYER_SIGNATURE);
      }
    });

    test('fails execution without payee signature', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Test payment',
      });

      const signingData = transactions.getSigningData(tx);
      const payerSig = crypto.sign(JSON.stringify(signingData), keypairs.get('alice')!.secretKey);
      await transactions.signAsPayer(tx.id, payerSig.ok ? payerSig.value : '');

      try {
        await transactions.executeTransaction(tx.id);
        fail('Expected INVALID_PAYEE_SIGNATURE error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.INVALID_PAYEE_SIGNATURE);
      }
    });

    test('fails if payer capacity changed since creation', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 80,
        description: 'Test payment',
      });

      const signingData = transactions.getSigningData(tx);

      // Sign both
      const payerSig = crypto.sign(JSON.stringify(signingData), keypairs.get('alice')!.secretKey);
      await transactions.signAsPayer(tx.id, payerSig.ok ? payerSig.value : '');

      const payeeSig = crypto.sign(JSON.stringify(signingData), keypairs.get('bob')!.secretKey);
      await transactions.signAsPayee(tx.id, payeeSig.ok ? payeeSig.value : '');

      // Alice's capacity decreases due to another transaction
      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -50, reason: 'SPOT_TRANSACTION_PAYER' as any },
        { memberId: 'charlie', delta: +50, reason: 'SPOT_TRANSACTION_PAYEE' as any },
      ]);

      // Now alice can only spend 50 more, but tx needs 80
      try {
        await transactions.executeTransaction(tx.id);
        fail('Expected INSUFFICIENT_CAPACITY error');
      } catch (e) {
        expect((e as TransactionValidationError).code).toBe(TransactionErrorCode.INSUFFICIENT_CAPACITY);
      }
    });
  });

  describe('Transaction History', () => {
    test('retrieves member transaction history', async () => {
      // Create and execute a transaction
      const tx1 = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 30,
        description: 'Payment 1',
      });

      const signingData1 = transactions.getSigningData(tx1);
      const payerSig1 = crypto.sign(JSON.stringify(signingData1), keypairs.get('alice')!.secretKey);
      await transactions.signAsPayer(tx1.id, payerSig1.ok ? payerSig1.value : '');
      const payeeSig1 = crypto.sign(JSON.stringify(signingData1), keypairs.get('bob')!.secretKey);
      await transactions.signAsPayee(tx1.id, payeeSig1.ok ? payeeSig1.value : '');
      await transactions.executeTransaction(tx1.id);

      // Create another transaction
      const tx2 = await transactions.createSpotTransaction({
        payer: 'bob',
        payee: 'alice',
        amount: 10,
        description: 'Payment 2',
      });

      // Get alice's transactions
      const aliceTxs = await transactions.getMemberTransactions('alice');

      expect(aliceTxs.length).toBe(2);
      expect(aliceTxs.some(tx => tx.id === tx1.id)).toBe(true);
      expect(aliceTxs.some(tx => tx.id === tx2.id)).toBe(true);
    });
  });

  describe('Offline Queue', () => {
    test('queues transactions for offline execution', async () => {
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Offline payment',
      });

      await transactions.queueForOffline(tx);

      const queue = await transactions.getOfflineQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].transaction.id).toBe(tx.id);
    });

    test('processes offline queue', async () => {
      // Create and fully sign a transaction
      const tx = await transactions.createSpotTransaction({
        payer: 'alice',
        payee: 'bob',
        amount: 50,
        description: 'Offline payment',
      });

      const signingData = transactions.getSigningData(tx);
      const payerSig = crypto.sign(JSON.stringify(signingData), keypairs.get('alice')!.secretKey);
      await transactions.signAsPayer(tx.id, payerSig.ok ? payerSig.value : '');
      const payeeSig = crypto.sign(JSON.stringify(signingData), keypairs.get('bob')!.secretKey);
      await transactions.signAsPayee(tx.id, payeeSig.ok ? payeeSig.value : '');

      // Queue it
      const signedTx = await transactions.getTransaction(tx.id);
      await transactions.queueForOffline(signedTx!);

      // Process queue
      const results = await transactions.processOfflineQueue();

      expect(results.length).toBe(1);
      expect(results[0].transaction.status).toBe(TransactionStatus.EXECUTED);

      // Queue should be empty
      const queue = await transactions.getOfflineQueue();
      expect(queue.length).toBe(0);
    });
  });
});
