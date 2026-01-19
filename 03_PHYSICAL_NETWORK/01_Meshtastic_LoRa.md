# Meshtastic & LoRa - Off-Grid Communication

## The Sovereignty Layer

> "From backcountry adventures to disaster response and decentralized events, the need for reliable, long-range, and infrastructure-free communication is growing fast."
> — Seeed Studio, 2025

If they control the network, they control access. **Own the physical layer.**

---

## What is Meshtastic?

Meshtastic is a **decentralized wireless off-grid mesh networking LoRa protocol**.

**Website:** https://meshtastic.org/
**GitHub:** https://github.com/meshtastic
**License:** Open Source (GPL-3.0)
**Created:** 2020 by Kevin Hester

### Core Features
| Feature | Capability |
|---------|------------|
| Range | Kilometers without line-of-sight |
| Power | Week+ battery life on single charge |
| Encryption | AES256 for all messages |
| Cost | Devices from ~$30 |
| License | ISM bands, no license required |
| Internet | Works completely offline |

---

## How It Works

### LoRa (Long Range) Radio
- Uses sub-GHz frequencies (868 MHz EU, 915 MHz US)
- Trades speed for distance
- Low power consumption
- Penetrates buildings, terrain

### Mesh Networking
```
[Your Device] --radio--> [Relay Node] --radio--> [Destination]
                              |
                         [Other Relay]
```

Messages automatically hop through available nodes. No central router.

### Encryption
- AES256 encryption standard
- Pre-shared keys for private channels
- Group channels for community broadcast
- Protection against eavesdropping

---

## Hardware Options

### Entry Level (~$30-50)
- **T-Echo** - Popular compact device
- **Heltec LoRa 32** - Development board
- **LILYGO T-Beam** - GPS integrated

### Production Ready (~$50-100)
- **RAK WisBlock** - Modular, rugged
- **T1000-E** - Best-selling commercial device
- **Station G2** - Solar-ready base station

### Core Chips
- **ESP32** - Processing, WiFi/BLE
- **nRF52840** - Low power alternative
- **SX1262** - LoRa radio chip

---

## Real-World Deployments

### Mars Society
- Uses Meshtastic T-Echo radios
- Analog astronaut missions in remote areas
- Weeks-long expeditions
- Critical safety communication

### DEF CON 2024
- Specialized firmware for large events
- 2,000-2,500 simultaneous nodes
- Lessons learned from Hamvention crash

### Municipal Backup Networks
- Disaster resilience planning
- Community emergency communication
- Government exploration ongoing

---

## Relevance to TechnoCommune

### Primary Use Cases

#### 1. Marketplace Announcements
```
[Farmer] --broadcast--> "Fresh asparagus available at market today"
```
Low-bandwidth text perfect for LoRa.

#### 2. Transaction Verification
```
[Buyer] --message--> [Seller] --message--> [Witness 1] --message--> [Witness 2]
                                                |
                                    "Trade confirmed: 10 credits"
```
Multi-signature "Proof of Care" over mesh.

#### 3. Emergency Coordination
When internet/mobile fails, community still communicates.

#### 4. Sensor Networks
LoRa sensors can verify:
- Farm activity (Proof of Work)
- Environmental conditions
- Resource usage

---

## MeshCore Alternative

**MeshCore** is a lightweight C++ library for developers who want more control:

| Aspect | Meshtastic | MeshCore |
|--------|------------|----------|
| Type | Complete system | Developer library |
| Ease | Ready to use | Build your own |
| Flexibility | Configured | Unlimited |
| Community | Large | Growing |

For TechnoCommune MVP, **Meshtastic** is recommended. MeshCore for future custom development.

---

## Network Architecture for TechnoCommune

### Phase 1: Core Infrastructure
```
[Solar Repeater - Hilltop]
        |
        | (LoRa)
        |
[Community Hub - Village] <--WiFi--> [Member Phones]
        |
        | (LoRa)
        |
[Farm Nodes] --> [Sensor Data]
```

### Phase 2: Mesh Expansion
```
[Village A Hub] <--LoRa--> [Hilltop Relay] <--LoRa--> [Village B Hub]
                                  |
                            [Valley Relay]
                                  |
                            [Village C Hub]
```

### Phase 3: Ledger Integration
```
[Member App]
    |
    | (Bluetooth)
    |
[LoRa Device]
    |
    | (Meshtastic Protocol)
    |
[Community Hub]
    |
    | (CouchDB Sync when online)
    |
[Backup/Archive]
```

---

## Technical Considerations

### Bandwidth Limitations
- ~100-300 bytes per message
- Suitable for: text, transaction data, GPS
- Not suitable for: images, voice, video

### Channel Configuration
- Create private channel with AES key
- Share key only with community members
- Secondary channel for public announcements

### Power Management
- Solar charging recommended for relays
- Battery life: days to weeks depending on activity
- Low-power modes for sensors

---

## Sources

- [Meshtastic Official](https://meshtastic.org/)
- [Meshtastic Introduction](https://meshtastic.org/docs/introduction/)
- [Seeed Studio - Meshtastic Guide 2025](https://www.seeedstudio.com/blog/2025/07/10/meshtastic-off-grid-mesh-network/)
- [LoRa Radio Reviews - Off-Grid Communication](https://loraradioreviews.com/2025/08/19/exploring-off-grid-communication-lora-radios-meshtastic-devices-pmr-walkie-talkies-and-mesh-networking/)
- [MeshCore vs Meshtastic](https://meshunderground.com/posts/1743603201715-meshcore-vs-meshtastic---choosing-your-off-grid-lora-network/)
- [RAK Meshtastic Store](https://store.rakwireless.com/collections/meshtastic)

---

## Next Steps

1. [ ] Order 3x T-Echo devices for testing
2. [ ] Set up private channel with AES key
3. [ ] Test range in local terrain
4. [ ] Prototype transaction message format
5. [ ] Design solar repeater station
6. [ ] Integrate with PouchDB sync events
