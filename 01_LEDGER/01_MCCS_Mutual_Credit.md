# MCCS - Mutual Credit Communication System

## Overview

The Mutual Credit Communication System (MCCS) is a web application that enables a network of trusted individuals and businesses to pay each other without the need for conventional money.

**Status:** Open source, MIT License
**Primary Repository:** https://github.com/ic3software/mccs
**Last Updated:** December 2022 (main repo archived)

---

## How It Works

### Core Mechanism
Unlike cryptocurrency where you must acquire tokens, mutual credit starts everyone at zero:
- When you **sell** goods/services, your account goes **positive**
- When you **buy** goods/services, your account goes **negative**
- The **community net balance is always zero**

No money changes hands. No bank required. No interest charged.

### Four Main Functions

1. **Account Management** - Create and modify user accounts and business details
2. **Business Discovery** - View and search businesses by what they sell and need
3. **Offers & Wants Matching** - List what you can provide and what you need
4. **Trade Matching Algorithm** - System proposes potential trades between users

---

## Technical Specifications

### Requirements
- Go version 1.13+
- Docker and Docker Compose
- PostgreSQL database

### Architecture
- Written in Go
- Docker Compose orchestration
- RESTful API for custom front-ends
- Supports mobile app development

### Key Feature: API-First Design
The API allows developers to:
- Create custom user interfaces
- Localize for any language
- Optimize for any device
- Build native mobile apps

---

## Relevance to TechnoCommune

### Strengths
- **Open source** - Can be forked and modified
- **No fiat dependency** - Pure credit clearing
- **Proven concept** - Built for Open Credit Network
- **API flexibility** - Can add offline-first layer

### Weaknesses
- **Repository archived** - No active development since 2022
- **Requires internet** - Not offline-first by default
- **Server-dependent** - Needs hosting infrastructure

### Modification Requirements
To use for TechnoCommune:
1. Fork and update dependencies
2. Add offline-first sync layer (PouchDB)
3. Implement mesh network API
4. Add multi-signature verification for "Proof of Care"

---

## Related Repositories

| Repository | Description | Status |
|------------|-------------|--------|
| [mccs](https://github.com/ic3software/mccs) | Main MCCS application | Archived Dec 2022 |
| [mccs-alpha](https://github.com/ic3software/mccs-alpha) | Prototype version | Archived Apr 2025 |
| [mccs-alpha-api](https://github.com/ic3software/mccs-alpha-api) | API server | Archived May 2024 |

---

## Sources

- [MCCS GitHub Repository](https://github.com/ic3software/mccs)
- [Open Credit Network - MCCS Article](https://opencredit.network/2022/02/22/mccs-open-source-mutual-credit-software/)
- [OCN API Documentation](https://opencredit.network/2020/07/09/an-open-source-api-for-mutual-credit-trading-groups/)

---

## Next Steps

1. [ ] Clone and audit MCCS codebase
2. [ ] Identify offline-first integration points
3. [ ] Design PouchDB sync layer
4. [ ] Prototype mesh network transport
