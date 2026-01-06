# OpenGoban

Community mutual credit trading - offline first, no banks, no app stores.

## What is this?

OpenGoban is a Progressive Web App (PWA) for community-based mutual credit trading. It works completely offline using QR codes for transfers between members.

## Features

- **Offline-first**: Works without internet connection
- **QR transfers**: Scan QR codes to send/receive credits
- **Cryptographic identity**: Ed25519 key pairs, no email/password needed
- **Circle-based**: Communities manage their own trading circles
- **No app store**: Install directly from browser

## Install

1. Visit [opengoban.com](https://www.opengoban.com) on your phone
2. Tap "Add to Home Screen" (iOS) or install prompt (Android)
3. Create your identity
4. Start trading!

## Technology

- PouchDB for offline database
- TweetNaCl.js for Ed25519 cryptography
- QRCode.js + jsQR for QR generation/scanning
- Service Worker for offline caching
- No build step - vanilla JavaScript

## Development

```bash
# Serve locally
python3 -m http.server 8080

# Open http://localhost:8080
```

## License

MIT
