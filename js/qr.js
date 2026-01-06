/**
 * OpenGoban QR Code Module
 *
 * Handles QR code generation and scanning for offline transfers
 * Uses qrcode.js for generation and jsQR for scanning
 */

const OGQR = (function() {
  'use strict';

  // Maximum data size for QR codes (Version 40 with L error correction)
  const MAX_QR_DATA = 2953;

  // QR code types
  const QR_TYPES = {
    TRANSACTION: 'TX',
    MEMBER_INFO: 'MEM',
    CIRCLE_INVITE: 'INV',
    VOUCH_REQUEST: 'VCH'
  };

  // ========================================
  // QR CODE GENERATION
  // ========================================

  /**
   * Generate a QR code and render it to a container
   * @param {string} containerId - DOM element ID to render into
   * @param {string} data - Data to encode
   * @param {object} options - QR options (width, colorDark, colorLight)
   * @returns {object} QRCode instance
   */
  function generateQR(containerId, data, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error('QR container not found: ' + containerId);
    }

    // Clear existing QR
    container.innerHTML = '';

    // Check data size
    if (data.length > MAX_QR_DATA) {
      throw new Error('Data too large for QR code: ' + data.length + ' bytes');
    }

    // Default options
    const qrOptions = {
      text: data,
      width: options.width || 256,
      height: options.height || 256,
      colorDark: options.colorDark || '#000000',
      colorLight: options.colorLight || '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    };

    return new QRCode(container, qrOptions);
  }

  /**
   * Generate a QR code as data URL (for saving/sharing)
   * @param {string} data - Data to encode
   * @param {number} size - Image size in pixels
   * @returns {Promise<string>} Data URL of the QR image
   */
  function generateQRDataURL(data, size = 256) {
    return new Promise((resolve, reject) => {
      // Create temporary container
      const tempDiv = document.createElement('div');
      tempDiv.style.display = 'none';
      document.body.appendChild(tempDiv);

      try {
        const qr = new QRCode(tempDiv, {
          text: data,
          width: size,
          height: size,
          colorDark: '#000000',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.L
        });

        // QRCode.js creates a canvas, get its data URL
        setTimeout(() => {
          const canvas = tempDiv.querySelector('canvas');
          if (canvas) {
            resolve(canvas.toDataURL('image/png'));
          } else {
            // Fallback to img element
            const img = tempDiv.querySelector('img');
            if (img) {
              resolve(img.src);
            } else {
              reject(new Error('QR code generation failed'));
            }
          }
          document.body.removeChild(tempDiv);
        }, 100);
      } catch (err) {
        document.body.removeChild(tempDiv);
        reject(err);
      }
    });
  }

  // ========================================
  // QR CODE SCANNING
  // ========================================

  let scannerActive = false;
  let videoStream = null;
  let animationFrame = null;

  /**
   * Start the QR scanner
   * @param {string} videoElementId - ID of video element to use
   * @param {function} onScan - Callback when QR is detected (receives decoded data)
   * @param {function} onError - Callback on error
   */
  async function startScanner(videoElementId, onScan, onError) {
    const video = document.getElementById(videoElementId);
    if (!video) {
      onError(new Error('Video element not found: ' + videoElementId));
      return;
    }

    if (scannerActive) {
      console.warn('Scanner already active');
      return;
    }

    try {
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Prefer rear camera
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      videoStream = stream;
      video.srcObject = stream;
      video.setAttribute('playsinline', true); // Required for iOS
      await video.play();

      scannerActive = true;

      // Create canvas for frame processing
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      // Scan loop
      function scanFrame() {
        if (!scannerActive) return;

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
          });

          if (code && code.data) {
            // QR code detected!
            console.log('[QR] Code detected:', code.data.substring(0, 50) + '...');
            onScan(code.data);
            return; // Stop scanning after successful read
          }
        }

        animationFrame = requestAnimationFrame(scanFrame);
      }

      scanFrame();

    } catch (err) {
      console.error('[QR] Scanner error:', err);
      onError(err);
    }
  }

  /**
   * Stop the QR scanner
   */
  function stopScanner() {
    scannerActive = false;

    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
      videoStream = null;
    }
  }

  /**
   * Check if camera is available
   */
  async function hasCamera() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(device => device.kind === 'videoinput');
    } catch (err) {
      return false;
    }
  }

  // ========================================
  // TRANSACTION QR ENCODING
  // ========================================

  /**
   * Create a transaction QR payload
   * This is what gets encoded in the QR code
   */
  function createTransactionPayload(tx, senderSignature) {
    return JSON.stringify({
      t: QR_TYPES.TRANSACTION,
      v: 1, // Version
      tx: {
        s: tx.sender_id,
        r: tx.recipient_id,
        a: tx.amount,
        d: tx.description,
        c: tx.created_at,
        n: tx.nonce
      },
      sig: senderSignature
    });
  }

  /**
   * Parse a transaction QR payload
   */
  function parseTransactionPayload(data) {
    try {
      const parsed = JSON.parse(data);

      if (parsed.t !== QR_TYPES.TRANSACTION) {
        throw new Error('Not a transaction QR code');
      }

      return {
        type: 'transaction',
        version: parsed.v,
        transaction: {
          sender_id: parsed.tx.s,
          recipient_id: parsed.tx.r,
          amount: parsed.tx.a,
          description: parsed.tx.d,
          created_at: parsed.tx.c,
          nonce: parsed.tx.n
        },
        senderSignature: parsed.sig
      };
    } catch (err) {
      console.error('[QR] Failed to parse transaction payload:', err);
      return null;
    }
  }

  // ========================================
  // MEMBER INFO QR ENCODING
  // ========================================

  /**
   * Create a member info QR payload (for sharing your identity)
   */
  function createMemberPayload(memberId, handle, publicKey, circleId) {
    return JSON.stringify({
      t: QR_TYPES.MEMBER_INFO,
      v: 1,
      m: {
        id: memberId,
        h: handle,
        pk: publicKey,
        c: circleId
      }
    });
  }

  /**
   * Parse a member info QR payload
   */
  function parseMemberPayload(data) {
    try {
      const parsed = JSON.parse(data);

      if (parsed.t !== QR_TYPES.MEMBER_INFO) {
        throw new Error('Not a member info QR code');
      }

      return {
        type: 'member',
        version: parsed.v,
        member: {
          id: parsed.m.id,
          handle: parsed.m.h,
          publicKey: parsed.m.pk,
          circleId: parsed.m.c
        }
      };
    } catch (err) {
      console.error('[QR] Failed to parse member payload:', err);
      return null;
    }
  }

  // ========================================
  // CIRCLE INVITE QR ENCODING
  // ========================================

  /**
   * Create a circle invite QR payload
   */
  function createInvitePayload(circleId, circleName, inviterId, inviterHandle) {
    return JSON.stringify({
      t: QR_TYPES.CIRCLE_INVITE,
      v: 1,
      i: {
        c: circleId,
        n: circleName,
        by: inviterId,
        bh: inviterHandle
      }
    });
  }

  /**
   * Parse a circle invite QR payload
   */
  function parseInvitePayload(data) {
    try {
      const parsed = JSON.parse(data);

      if (parsed.t !== QR_TYPES.CIRCLE_INVITE) {
        throw new Error('Not a circle invite QR code');
      }

      return {
        type: 'invite',
        version: parsed.v,
        invite: {
          circleId: parsed.i.c,
          circleName: parsed.i.n,
          inviterId: parsed.i.by,
          inviterHandle: parsed.i.bh
        }
      };
    } catch (err) {
      console.error('[QR] Failed to parse invite payload:', err);
      return null;
    }
  }

  // ========================================
  // VOUCH REQUEST QR ENCODING
  // ========================================

  /**
   * Create a vouch request QR payload (new member asking to be vouched)
   */
  function createVouchRequestPayload(memberId, handle, publicKey) {
    return JSON.stringify({
      t: QR_TYPES.VOUCH_REQUEST,
      v: 1,
      r: {
        id: memberId,
        h: handle,
        pk: publicKey
      }
    });
  }

  /**
   * Parse a vouch request QR payload
   */
  function parseVouchRequestPayload(data) {
    try {
      const parsed = JSON.parse(data);

      if (parsed.t !== QR_TYPES.VOUCH_REQUEST) {
        throw new Error('Not a vouch request QR code');
      }

      return {
        type: 'vouch_request',
        version: parsed.v,
        request: {
          memberId: parsed.r.id,
          handle: parsed.r.h,
          publicKey: parsed.r.pk
        }
      };
    } catch (err) {
      console.error('[QR] Failed to parse vouch request payload:', err);
      return null;
    }
  }

  // ========================================
  // UNIVERSAL PARSER
  // ========================================

  /**
   * Parse any OpenGoban QR code
   * Returns the parsed payload with type indicator
   */
  function parseQR(data) {
    try {
      const parsed = JSON.parse(data);

      switch (parsed.t) {
        case QR_TYPES.TRANSACTION:
          return parseTransactionPayload(data);
        case QR_TYPES.MEMBER_INFO:
          return parseMemberPayload(data);
        case QR_TYPES.CIRCLE_INVITE:
          return parseInvitePayload(data);
        case QR_TYPES.VOUCH_REQUEST:
          return parseVouchRequestPayload(data);
        default:
          console.warn('[QR] Unknown QR type:', parsed.t);
          return { type: 'unknown', raw: data };
      }
    } catch (err) {
      // Not JSON - might be a URL or other data
      console.warn('[QR] Non-JSON QR data:', data.substring(0, 50));
      return { type: 'raw', data: data };
    }
  }

  // ========================================
  // PUBLIC API
  // ========================================

  return {
    // Generation
    generateQR,
    generateQRDataURL,

    // Scanning
    startScanner,
    stopScanner,
    hasCamera,

    // Transaction encoding
    createTransactionPayload,
    parseTransactionPayload,

    // Member encoding
    createMemberPayload,
    parseMemberPayload,

    // Invite encoding
    createInvitePayload,
    parseInvitePayload,

    // Vouch request encoding
    createVouchRequestPayload,
    parseVouchRequestPayload,

    // Universal parser
    parseQR,

    // Constants
    QR_TYPES,
    MAX_QR_DATA
  };
})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OGQR;
}
