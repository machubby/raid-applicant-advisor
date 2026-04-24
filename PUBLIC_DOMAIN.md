# Public Domain Setup

These steps expose your local Raid Applicant Advisor server from your PC through HTTPS while keeping the app behind an unguessable share link.

## Is This Totally Free?

Cloudflare Tunnel itself is free. The only catch is the domain name:

- If you already own a domain, this setup can be free.
- If you do not own a domain, you can use a free Quick Tunnel for testing, but it gives you a random `trycloudflare.com` URL each time and is not a stable real domain.
- A stable URL such as `https://raa.yourdomain.com/...` requires a domain you own.

## Recommended Setup: Cloudflare Tunnel

Cloudflare Tunnel is the easiest setup because it does not require router port forwarding. Your PC keeps running the local app on `127.0.0.1:4177`, and `cloudflared` connects that local port to your domain.

### 1. Put The Domain On Cloudflare

In Cloudflare, add your domain and follow Cloudflare's nameserver instructions at your registrar. Once Cloudflare shows the domain as active, continue.

### 2. Install `cloudflared` On Windows

Open PowerShell:

```powershell
winget install --id Cloudflare.cloudflared
```

Cloudflare's Windows installer does not auto-update, so occasionally rerun the installer or update it from Cloudflare's downloads page.

### 3. Add A Share Token

From this project folder:

```powershell
$token = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
Add-Content .env "RAA_SHARE_TOKEN=$token"
$token
```

Keep your existing Warcraft Logs credentials in `.env` too:

```text
WCL_CLIENT_ID=your-client-id
WCL_CLIENT_SECRET=your-client-secret
PORT=4177
RAA_SHARE_TOKEN=your-long-random-token
```

Restart the local RAA server after changing `.env`.

### 4. Create The Tunnel

In Cloudflare:

1. Open the Cloudflare dashboard.
2. Go to Zero Trust, then Tunnels or Networks > Tunnels.
3. Create a tunnel for this PC.
4. Choose the Windows connector option.
5. Copy the install command Cloudflare gives you.
6. Run that command in an Administrator PowerShell window. It will look like this:

```powershell
cloudflared.exe service install <TUNNEL_TOKEN>
```

This installs `cloudflared` as a Windows service, so it reconnects after reboot.

### 5. Publish The App Hostname

On the tunnel page, add a Published Application route:

```text
Public hostname: raa.yourdomain.com
Service type: HTTP
Service URL: http://127.0.0.1:4177
```

Cloudflare creates the DNS record automatically when you add the route.

### 6. Send The Share Link

Send your co-lead this form of URL:

```text
https://raa.yourdomain.com/r/your-long-random-token/
```

Opening that URL sets a same-site cookie, so the page can load its CSS, JavaScript, and API calls without putting the token on every request.

This fallback form also works:

```text
https://raa.yourdomain.com/?key=your-long-random-token
```

## Quick Tunnel For Testing

The easiest way to start a temporary share link is:

```powershell
.\scripts\Start-RAA-Share.ps1
```

That script:

- creates `RAA_SHARE_TOKEN` in `.env` if needed
- starts the local RAA server if it is not already running
- starts a Cloudflare Quick Tunnel
- prints the exact `/r/<token>/` link to send
- copies that link to your clipboard when possible

Keep the PowerShell window open while your buddy is using the link.

You can also run the Cloudflare command manually.

If you want to test without configuring a domain:

```powershell
cloudflared tunnel --url http://127.0.0.1:4177
```

Cloudflare prints a temporary `trycloudflare.com` URL. This is useful for a quick test, but it is not the final setup because the hostname is random and can change.

## Shared Decisions

Accept and Decline decisions are stored by the local RAA server in:

```text
artifacts/shared-decisions.json
```

Every browser connected to the same server polls that shared state. That means:

- Accept adds the applicant to the shared roster planner and removes them from the ranking pool for everyone.
- Decline hides the applicant from the ranking pool for everyone.
- Clear Accepted and Clear Declined clear the shared server state.
- When a later addon import shows an accepted applicant in the real roster, that accepted decision is automatically removed from the shared state.

## Important Limitations

- Anyone with the share link can use your app and spend your Warcraft Logs API points.
- The token is a shared secret, not a full login system. Rotate it by changing `RAA_SHARE_TOKEN` and restarting the server.
- The clipboard bridge still runs on the host PC. A co-lead viewing the domain can see imports copied on the host PC, but they cannot read their own PC clipboard through your server.
- For stronger access control, put Cloudflare Access in front of the hostname and require specific email logins.

## Alternative: Port Forwarding

You can also point a domain to your home IP and use a reverse proxy such as Caddy in front of `http://127.0.0.1:4177`, but that requires router port forwarding and firewall work. Cloudflare Tunnel is usually less fragile for this use case.
