# DNS cannot resolve `trycloudflare.com`

## Symptom
The app prints a tunnel URL, but the tunnel is dead, or it fails immediately with:

```text
failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host
```

The application can also detect this before starting the tunnel and shows:

```text
Your DNS cannot resolve api.trycloudflare.com, so the tunnel cannot be created.
```

## Why it happens

To create a quick tunnel, `cloudflared` must resolve `api.trycloudflare.com` (the cloudflare API 
that allocates the tunnel) before it can start. The final public URL is a random hostname such as `https://some-words-here.trycloudflare.com`, so the same DNS zone must be resolvable.

If the DNS server that your computer uses cannot resolve that zone, no tunnel can ever be created. This is a network/dns problem, not a problem with the app.

Causes:

- Router (or the ISP resolver behind it) fails to resolve `trycloudflare.com` while resolving other domains normally
- A stale negative DNS cache in the router
- A DNS filter, parental control, antivirus DNS filter, or corporate proxy on the network

It can start working again on its own after the router/ISP cache expires, but it's not reliable.

## Diagnose this

Run this in a terminal on the machine that runs the app:

```bash
nslookup api.trycloudflare.com
```

Compare with a public resolver:

```bash
nslookup api.trycloudflare.com 1.1.1.1
nslookup api.trycloudflare.com 8.8.8.8
```

- If the first command fails and the public resolvers answer, your default resolver is the problem.
- If every command fails, the whole zone is being blocked on that network.

On Windows you can also use:

```powershell
Resolve-DnsName api.trycloudflare.com
Resolve-DnsName api.trycloudflare.com -Server 1.1.1.1
```

## Fix

Point the computer to a public DNS resolver. This only changes who answers name lookups. IP assignment, routing, firewall and internet access are untouched.

### Windows

1. Open `ncpa.cpl` (Network Connections).
2. Right-click your active adapter (Ethernet or Wi-Fi) → **Properties**.
3. Select **Internet Protocol Version 4 (TCP/IPv4)** → **Properties**.
4. Choose *Use the following DNS server addresses*, enter:
   - Preferred: `1.1.1.1`
   - Alternate: `8.8.8.8`
5. Click ok / Close on all dialogs.
6. Refresh the cache:
   ```powershell
   ipconfig /flushdns
   ```
7. Verify and start the app again:
   ```powershell
   nslookup api.trycloudflare.com
   ```

Other usable public resolvers: `9.9.9.9` (Quad9), `208.67.222.222` (OpenDNS), `1.0.0.1`.

### Linux / WSL2

```bash
sudo nano /etc/resolv.conf
# replace the nameserver lines with:
nameserver 1.1.1.1
nameserver 8.8.8.8
```

On WSL2, `/etc/resolv.conf` is generated from the Windows resolver, so fixing the Windows DNS
also fixes WSL2. Make the change permanent in WSL2 with:

```bash
sudo sh -c 'printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n" > /etc/resolv.conf'
```

### macOS

System Settings -> Network -> your adapter -> Details -> DNS -> add `1.1.1.1` , `8.8.8.8`.

# Revert the change if something goes wrong (optional)

Follow this step only if after changing the DNS, you notice that your internet connection is slower, some websites won't load, or you simply aren't comfortable with the change. This reverses the process and restores the original settings in less than a minute, without restarting your PC.

## 1. Switch Back to Automatic DNS (Windows)

- Press Win + R, type ncpa.cpl, and press Enter
- Right-click Ethernet → Properties
- Select Internet Protocol Version 4 (TCP/IPv4) → Properties
- Select Obtain DNS server address automatically
- Click OK / Close on all dialogs

# 2. Flush the DNS Cache and Verify

```powershell
ipconfig /flushdns
nslookup api.trycloudflare.com
```

If the command shows your router's DNS server again (192.168.1.1), the rollback was applied successfully

# 3. Revert the Change in WSL2 as Well (If You Changed It)

WSL2 inherits DNS settings from Windows, so completing Step 7 should restore them automatically. If you previously applied the permanent change inside WSL2, revert it there as well:

```bash
sudo rm -f /etc/resolv.conf
sudo sh -c 'printf "nameserver 10.255.255.254\n" > /etc/resolv.conf'
```

Verify that the original setting has been restored

```bash
cat /etc/resolv.conf
```

It should display nameserver 10.255.255.254.

# 4. Confirm That Everything Is Working Properly

```powershell
nslookup www.google.com
```

If the command returns an IP address, your internet connection is working normally again. Nothing else needs to be done: the DNS change is fully reversible and did not modify your router, firewall, or the network configuration of any other device.
