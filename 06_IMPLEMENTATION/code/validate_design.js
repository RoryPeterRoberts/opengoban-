/**
 * CouchDB Design Document for TechnoCommune Ledger
 *
 * This file contains validation functions that run on every document write.
 * Upload to CouchDB as a design document.
 *
 * Usage:
 *   curl -X PUT http://admin:password@localhost:5984/ledger/_design/validate \
 *     -d @validate_design.json
 */

const designDoc = {
  "_id": "_design/validate",
  "language": "javascript",

  // Validation function runs on every document write
  "validate_doc_update": `function(newDoc, oldDoc, userCtx, secObj) {

    // Helper functions
    function require(field, message) {
      if (!newDoc[field]) {
        throw({ forbidden: message || 'Missing required field: ' + field });
      }
    }

    function isValidUUID(str) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    }

    function isValidHandle(str) {
      return /^[a-zA-Z0-9_]{3,32}$/.test(str);
    }

    function isValidTimestamp(str) {
      return !isNaN(Date.parse(str));
    }

    // Allow deletions (for admin cleanup)
    if (newDoc._deleted) {
      return;
    }

    // Require document type
    require('type', 'Document must have a type field');

    // Validate by document type
    switch (newDoc.type) {

      case 'member':
        // Member document validation
        require('handle', 'Member must have a handle');
        require('public_key', 'Member must have a public_key');
        require('created_at', 'Member must have created_at timestamp');

        if (!isValidHandle(newDoc.handle)) {
          throw({ forbidden: 'Handle must be 3-32 alphanumeric characters or underscore' });
        }

        if (!isValidTimestamp(newDoc.created_at)) {
          throw({ forbidden: 'Invalid created_at timestamp' });
        }

        // Status must be valid enum
        var validStatuses = ['pending', 'active', 'suspended', 'departed'];
        if (newDoc.status && validStatuses.indexOf(newDoc.status) === -1) {
          throw({ forbidden: 'Invalid status. Must be: ' + validStatuses.join(', ') });
        }

        // Credit limits must be valid
        if (newDoc.credit_limit) {
          if (typeof newDoc.credit_limit.min !== 'number' ||
              typeof newDoc.credit_limit.max !== 'number') {
            throw({ forbidden: 'Credit limit min and max must be numbers' });
          }
          if (newDoc.credit_limit.min > 0) {
            throw({ forbidden: 'Credit limit min cannot be positive' });
          }
          if (newDoc.credit_limit.max < 0) {
            throw({ forbidden: 'Credit limit max cannot be negative' });
          }
        }
        break;

      case 'transaction':
        // Transaction document validation
        require('created_at', 'Transaction must have created_at timestamp');
        require('sender_id', 'Transaction must have sender_id');
        require('recipient_id', 'Transaction must have recipient_id');
        require('amount', 'Transaction must have amount');
        require('description', 'Transaction must have description');

        if (!isValidTimestamp(newDoc.created_at)) {
          throw({ forbidden: 'Invalid created_at timestamp' });
        }

        // Amount validation
        if (typeof newDoc.amount !== 'number') {
          throw({ forbidden: 'Amount must be a number' });
        }
        if (newDoc.amount <= 0) {
          throw({ forbidden: 'Amount must be positive' });
        }
        if (newDoc.amount > 100) {
          throw({ forbidden: 'Amount cannot exceed 100 credits per transaction' });
        }
        if (newDoc.amount !== Math.floor(newDoc.amount)) {
          throw({ forbidden: 'Amount must be a whole number' });
        }

        // Cannot send to self
        if (newDoc.sender_id === newDoc.recipient_id) {
          throw({ forbidden: 'Cannot send credits to yourself' });
        }

        // Status must be valid enum
        var txStatuses = ['pending', 'confirmed', 'disputed', 'cancelled'];
        if (newDoc.status && txStatuses.indexOf(newDoc.status) === -1) {
          throw({ forbidden: 'Invalid status. Must be: ' + txStatuses.join(', ') });
        }

        // Require sender signature
        if (!newDoc.signatures || !newDoc.signatures.sender) {
          throw({ forbidden: 'Transaction must have sender signature' });
        }
        break;

      case 'mint':
        // Mint (Proof of Care) document validation
        require('created_at', 'Mint must have created_at timestamp');
        require('beneficiaries', 'Mint must have beneficiaries');
        require('work_type', 'Mint must have work_type');
        require('description', 'Mint must have description');

        if (!isValidTimestamp(newDoc.created_at)) {
          throw({ forbidden: 'Invalid created_at timestamp' });
        }

        // Beneficiaries must be array
        if (!Array.isArray(newDoc.beneficiaries)) {
          throw({ forbidden: 'Beneficiaries must be an array' });
        }

        if (newDoc.beneficiaries.length === 0) {
          throw({ forbidden: 'Must have at least one beneficiary' });
        }

        // Validate each beneficiary
        var totalAmount = 0;
        for (var i = 0; i < newDoc.beneficiaries.length; i++) {
          var b = newDoc.beneficiaries[i];
          if (!b.member_id || typeof b.amount !== 'number') {
            throw({ forbidden: 'Each beneficiary must have member_id and amount' });
          }
          if (b.amount <= 0 || b.amount > 50) {
            throw({ forbidden: 'Beneficiary amount must be 1-50' });
          }
          totalAmount += b.amount;
        }

        // Total mint limit
        if (totalAmount > 100) {
          throw({ forbidden: 'Total mint cannot exceed 100 credits per event' });
        }

        // Require minimum signatures for confirmed mints
        if (newDoc.status === 'confirmed') {
          var sigCount = 0;
          if (newDoc.signatures) {
            for (var key in newDoc.signatures) {
              if (newDoc.signatures[key]) sigCount++;
            }
          }
          var required = newDoc.required_signatures || 3;
          if (sigCount < required) {
            throw({ forbidden: 'Confirmed mint requires ' + required + ' signatures, has ' + sigCount });
          }
        }
        break;

      case 'announcement':
        // Announcement document validation
        require('created_at', 'Announcement must have created_at timestamp');
        require('author_id', 'Announcement must have author_id');
        require('title', 'Announcement must have title');
        require('body', 'Announcement must have body');

        if (newDoc.title.length > 100) {
          throw({ forbidden: 'Title cannot exceed 100 characters' });
        }
        if (newDoc.body.length > 2000) {
          throw({ forbidden: 'Body cannot exceed 2000 characters' });
        }
        break;

      case 'revocation':
        // Key revocation document
        require('created_at', 'Revocation must have created_at timestamp');
        require('target_member_id', 'Revocation must specify target member');
        require('reason', 'Revocation must have reason');
        require('signatures', 'Revocation must have signatures');

        // Require 3 elder signatures
        var revokeSigCount = 0;
        for (var k in newDoc.signatures) {
          if (newDoc.signatures[k]) revokeSigCount++;
        }
        if (revokeSigCount < 3) {
          throw({ forbidden: 'Revocation requires at least 3 signatures' });
        }
        break;

      default:
        throw({ forbidden: 'Unknown document type: ' + newDoc.type });
    }
  }`,

  // Views for querying data
  "views": {
    "members": {
      "map": `function(doc) {
        if (doc.type === 'member') {
          emit(doc.handle, {
            id: doc._id,
            handle: doc.handle,
            status: doc.status,
            offers: doc.offers,
            wants: doc.wants
          });
        }
      }`
    },

    "active_members": {
      "map": `function(doc) {
        if (doc.type === 'member' && doc.status === 'active') {
          emit(doc._id, doc.handle);
        }
      }`
    },

    "transactions_by_member": {
      "map": `function(doc) {
        if (doc.type === 'transaction' && doc.status === 'confirmed') {
          emit([doc.sender_id, doc.created_at], {
            type: 'sent',
            amount: doc.amount,
            counterparty: doc.recipient_id,
            description: doc.description
          });
          emit([doc.recipient_id, doc.created_at], {
            type: 'received',
            amount: doc.amount,
            counterparty: doc.sender_id,
            description: doc.description
          });
        }
      }`
    },

    "balances": {
      "map": `function(doc) {
        if (doc.type === 'transaction' && doc.status === 'confirmed') {
          emit(doc.sender_id, -doc.amount);
          emit(doc.recipient_id, doc.amount);
        }
        if (doc.type === 'mint' && doc.status === 'confirmed') {
          for (var i = 0; i < doc.beneficiaries.length; i++) {
            emit(doc.beneficiaries[i].member_id, doc.beneficiaries[i].amount);
          }
        }
      }`,
      "reduce": "_sum"
    },

    "total_minted": {
      "map": `function(doc) {
        if (doc.type === 'mint' && doc.status === 'confirmed') {
          emit('total', doc.total_minted || 0);
        }
      }`,
      "reduce": "_sum"
    },

    "announcements_active": {
      "map": `function(doc) {
        if (doc.type === 'announcement') {
          var now = new Date().toISOString();
          if (!doc.expires_at || doc.expires_at > now) {
            emit(doc.created_at, {
              title: doc.title,
              body: doc.body,
              author_id: doc.author_id,
              category: doc.category
            });
          }
        }
      }`
    },

    "revoked_keys": {
      "map": `function(doc) {
        if (doc.type === 'revocation' && doc.status === 'confirmed') {
          emit(doc.target_member_id, doc.created_at);
        }
      }`
    }
  }
};

// Export for Node.js usage
if (typeof module !== 'undefined') {
  module.exports = designDoc;
}

// For browser, attach to window
if (typeof window !== 'undefined') {
  window.TechnoCommune = window.TechnoCommune || {};
  window.TechnoCommune.designDoc = designDoc;
}
