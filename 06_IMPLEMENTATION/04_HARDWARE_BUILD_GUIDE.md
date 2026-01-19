# HARDWARE BUILD GUIDE
## The Community Box: Off-Grid CouchDB Hub

**Classification:** Internal - Engineering Document
**Difficulty:** Intermediate (command line required)
**Build Time:** 2-3 hours

---

## 1. SHOPPING LIST

### Core Components (Required)

| Item | Specification | Price (EUR) | Source |
|------|---------------|-------------|--------|
| Raspberry Pi 4 | 4GB RAM model | 55-65 | ThePiHut, Pimoroni |
| MicroSD Card | 32GB+ Class 10 | 10 | Amazon |
| USB SSD | 128GB+ USB 3.0 | 25-40 | Amazon |
| Power Supply | Official RPi 5.1V 3A USB-C | 10 | ThePiHut |
| Case | Aluminum heatsink case | 15 | Amazon |
| **SUBTOTAL** | | **~115** | |

### Off-Grid Power (Recommended)

| Item | Specification | Price (EUR) | Source |
|------|---------------|-------------|--------|
| Power Bank | 26800mAh, USB-C PD output | 50 | Anker, Amazon |
| Solar Panel | 20-50W portable, USB output | 40-80 | Amazon, camping stores |
| Solar Controller | PWM with USB output | 15 | Amazon |
| **SUBTOTAL** | | **~105-145** | |

### Mesh Networking (Optional Phase 2)

| Item | Specification | Price (EUR) | Source |
|------|---------------|-------------|--------|
| LoRa HAT | RAK2287 or Dragino | 50-80 | RAKwireless |
| Antenna | 868MHz EU, outdoor rated | 15 | Amazon |
| OR: Meshtastic Devices | T-Echo or T-Beam x3 | 90 | AliExpress, LilyGo |
| **SUBTOTAL** | | **~90-185** | |

### Total Investment

| Configuration | Cost |
|---------------|------|
| Minimum viable (grid power) | ~115 EUR |
| Off-grid capable | ~220 EUR |
| Full mesh network | ~400 EUR |

---

## 2. SOFTWARE INSTALLATION

### 2.1 Base System

```bash
# Download Raspberry Pi OS Lite (64-bit)
# Use Raspberry Pi Imager to flash to SD card
# Enable SSH during imaging (set username/password)

# First boot - connect via ethernet or configure WiFi
ssh pi@raspberrypi.local

# Update system
sudo apt update && sudo apt upgrade -y

# Set hostname
sudo hostnamectl set-hostname community-hub

# Configure timezone
sudo timedatectl set-timezone Europe/Dublin
```

### 2.2 Install CouchDB

```bash
# Add CouchDB repository
curl https://couchdb.apache.org/repo/keys.asc | gpg --dearmor | \
  sudo tee /usr/share/keyrings/couchdb-archive-keyring.gpg >/dev/null

echo "deb [signed-by=/usr/share/keyrings/couchdb-archive-keyring.gpg] \
  https://apache.jfrog.io/artifactory/couchdb-deb/ $(lsb_release -cs) main" | \
  sudo tee /etc/apt/sources.list.d/couchdb.list >/dev/null

# Install
sudo apt update
sudo apt install -y couchdb

# During install:
# - Choose "standalone" mode
# - Set admin password (REMEMBER THIS)
# - Bind to 0.0.0.0 (all interfaces)
```

### 2.3 Configure CouchDB

```bash
# Edit config
sudo nano /opt/couchdb/etc/local.ini

# Add these lines under [chttpd]:
[chttpd]
bind_address = 0.0.0.0
port = 5984

[couchdb]
single_node = true

# Restart
sudo systemctl restart couchdb

# Verify
curl http://localhost:5984/
# Should return: {"couchdb":"Welcome"...}
```

### 2.4 Create Ledger Database

```bash
# Create the main database
curl -X PUT http://admin:YOUR_PASSWORD@localhost:5984/ledger

# Enable CORS for web app access
curl -X PUT http://admin:YOUR_PASSWORD@localhost:5984/_node/_local/_config/httpd/enable_cors \
  -d '"true"'

curl -X PUT http://admin:YOUR_PASSWORD@localhost:5984/_node/_local/_config/cors/origins \
  -d '"*"'

curl -X PUT http://admin:YOUR_PASSWORD@localhost:5984/_node/_local/_config/cors/methods \
  -d '"GET, PUT, POST, HEAD, DELETE"'

curl -X PUT http://admin:YOUR_PASSWORD@localhost:5984/_node/_local/_config/cors/headers \
  -d '"accept, authorization, content-type, origin, referer"'
```

### 2.5 Move Database to SSD

```bash
# Format SSD (WARNING: erases all data)
sudo mkfs.ext4 /dev/sda1

# Create mount point
sudo mkdir /mnt/ssd
sudo mount /dev/sda1 /mnt/ssd

# Add to fstab for auto-mount
echo '/dev/sda1 /mnt/ssd ext4 defaults,noatime 0 2' | sudo tee -a /etc/fstab

# Stop CouchDB
sudo systemctl stop couchdb

# Move data
sudo mv /opt/couchdb/data /mnt/ssd/couchdb-data
sudo ln -s /mnt/ssd/couchdb-data /opt/couchdb/data
sudo chown -R couchdb:couchdb /mnt/ssd/couchdb-data

# Restart
sudo systemctl start couchdb
```

---

## 3. WIFI ACCESS POINT SETUP

Create a local network that members can connect to without internet.

### 3.1 Install hostapd and dnsmasq

```bash
sudo apt install -y hostapd dnsmasq

# Stop services while configuring
sudo systemctl stop hostapd
sudo systemctl stop dnsmasq
```

### 3.2 Configure Static IP

```bash
sudo nano /etc/dhcpcd.conf

# Add at the end:
interface wlan0
    static ip_address=192.168.4.1/24
    nohook wpa_supplicant
```

### 3.3 Configure DHCP Server

```bash
sudo mv /etc/dnsmasq.conf /etc/dnsmasq.conf.orig
sudo nano /etc/dnsmasq.conf

# Add:
interface=wlan0
dhcp-range=192.168.4.2,192.168.4.20,255.255.255.0,24h
domain=local
address=/community-hub.local/192.168.4.1
```

### 3.4 Configure Access Point

```bash
sudo nano /etc/hostapd/hostapd.conf

# Add:
interface=wlan0
driver=nl80211
ssid=COMMUNITY_HUB
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=2
wpa_passphrase=YOUR_WIFI_PASSWORD
wpa_key_mgmt=WPA-PSK
wpa_pairwise=TKIP
rsn_pairwise=CCMP

# Point hostapd to config
sudo nano /etc/default/hostapd
# Change: DAEMON_CONF="/etc/hostapd/hostapd.conf"
```

### 3.5 Enable and Start

```bash
sudo systemctl unmask hostapd
sudo systemctl enable hostapd
sudo systemctl enable dnsmasq
sudo reboot

# After reboot, you should see "COMMUNITY_HUB" WiFi network
```

---

## 4. SECURITY HARDENING

### 4.1 Firewall

```bash
sudo apt install -y ufw

# Default deny
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (for admin)
sudo ufw allow 22/tcp

# Allow CouchDB (local network only)
sudo ufw allow from 192.168.4.0/24 to any port 5984

# Allow DNS/DHCP
sudo ufw allow 53
sudo ufw allow 67/udp

# Enable
sudo ufw enable
```

### 4.2 Fail2ban

```bash
sudo apt install -y fail2ban

sudo nano /etc/fail2ban/jail.local
# Add:
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600

sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 4.3 Automatic Updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
# Select "Yes" for automatic security updates
```

---

## 5. MONITORING & MAINTENANCE

### 5.1 System Health Check Script

```bash
sudo nano /home/pi/health_check.sh
```

```bash
#!/bin/bash
echo "=== COMMUNITY HUB HEALTH CHECK ==="
echo "Date: $(date)"
echo ""
echo "=== DISK USAGE ==="
df -h /mnt/ssd
echo ""
echo "=== MEMORY ==="
free -h
echo ""
echo "=== COUCHDB STATUS ==="
curl -s http://localhost:5984/ | head -1
echo ""
echo "=== DATABASE SIZE ==="
curl -s http://admin:PASSWORD@localhost:5984/ledger | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Docs: {d.get(\"doc_count\",0)}, Size: {d.get(\"sizes\",{}).get(\"file\",0)/1024/1024:.2f} MB')"
echo ""
echo "=== CONNECTED DEVICES ==="
arp -a | grep -v incomplete
echo ""
echo "=== UPTIME ==="
uptime
```

```bash
chmod +x /home/pi/health_check.sh
```

### 5.2 Backup Script

```bash
sudo nano /home/pi/backup_ledger.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/mnt/ssd/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup CouchDB
curl -X GET "http://admin:PASSWORD@localhost:5984/ledger/_all_docs?include_docs=true" \
  > "$BACKUP_DIR/ledger_$DATE.json"

# Keep only last 7 backups
ls -t $BACKUP_DIR/ledger_*.json | tail -n +8 | xargs -r rm

echo "Backup completed: ledger_$DATE.json"
```

```bash
chmod +x /home/pi/backup_ledger.sh

# Add to crontab (daily at 3am)
(crontab -l 2>/dev/null; echo "0 3 * * * /home/pi/backup_ledger.sh") | crontab -
```

---

## 6. OFF-GRID POWER CONFIGURATION

### 6.1 Power Budget

| Component | Consumption |
|-----------|-------------|
| Raspberry Pi 4 (idle) | 3W |
| Raspberry Pi 4 (active) | 6W |
| USB SSD | 2W |
| WiFi AP active | +1W |
| **Total (typical)** | **5-9W** |

### 6.2 Battery Runtime

| Battery Capacity | Approx. Runtime |
|------------------|-----------------|
| 10,000 mAh (37Wh) | 4-7 hours |
| 20,000 mAh (74Wh) | 8-14 hours |
| 26,800 mAh (99Wh) | 11-20 hours |

### 6.3 Solar Sizing

For continuous operation in Irish climate:
- **Minimum:** 30W panel (4-5 hours sun = 120-150Wh)
- **Recommended:** 50W panel (200-250Wh on good day)
- **Winter buffer:** 100W panel or generator backup

### 6.4 Auto-Shutdown on Low Battery

```bash
# Install battery monitor (if using UPS HAT)
# For generic USB power monitoring:

sudo nano /home/pi/power_monitor.sh
```

```bash
#!/bin/bash
# Check for low voltage warning
if [ -f /sys/devices/platform/soc/soc:firmware/get_throttled ]; then
  THROTTLE=$(cat /sys/devices/platform/soc/soc:firmware/get_throttled)
  if [ "$THROTTLE" != "0" ]; then
    logger "Power warning detected, initiating safe shutdown"
    /home/pi/backup_ledger.sh
    sudo shutdown -h now
  fi
fi
```

---

## 7. VERIFICATION CHECKLIST

After setup, verify:

- [ ] `curl http://192.168.4.1:5984/` returns CouchDB welcome
- [ ] WiFi network "COMMUNITY_HUB" visible on phone
- [ ] Phone can connect and reach CouchDB
- [ ] Database "ledger" exists and accepts writes
- [ ] Backup script runs successfully
- [ ] System survives reboot
- [ ] (Off-grid) Runs 8+ hours on battery

---

## 8. TROUBLESHOOTING

| Problem | Solution |
|---------|----------|
| CouchDB won't start | Check logs: `journalctl -u couchdb` |
| WiFi AP not visible | Verify hostapd: `sudo systemctl status hostapd` |
| Can't reach from phone | Check firewall: `sudo ufw status` |
| Slow performance | Check if running on SD vs SSD |
| High temperature | Improve ventilation, add heatsink |
| Power issues | Check voltage: `vcgencmd get_throttled` |

---

## 9. PHYSICAL DEPLOYMENT

### Location Requirements
- Protected from rain (shed, covered porch)
- Within range of gathering area (~50m for strong WiFi)
- Southern exposure for solar (if applicable)
- Secure from casual tampering

### Weatherproofing
- Use IP65 rated enclosure for outdoor deployment
- Silica gel packets inside enclosure
- Cable glands for wire entry
- Ventilation with filter mesh

### Concealment Options
- Inside fake electrical box
- Built into furniture at gathering space
- Distributed across multiple locations (redundant hubs)

---

*Build once. Run forever. Own the infrastructure.*
