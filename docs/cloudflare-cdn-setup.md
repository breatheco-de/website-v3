# Cloudflare CDN Setup Guide

This guide explains how to place Cloudflare's free tier in front of the origin server (the DigitalOcean droplet) to improve LCP and overall performance.

## Prerequisites

- A domain you control (e.g. `yourschool.com`)
- Access to the domain's DNS registrar
- A Cloudflare account (free tier is sufficient)

## Steps

### 1. Add Your Domain to Cloudflare

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com) and click **Add a Site**.
2. Enter your domain and select the **Free** plan.
3. Cloudflare will scan your existing DNS records. Review and import them.
4. At your domain registrar, update the nameservers to the two Cloudflare nameservers shown (e.g. `aria.ns.cloudflare.com`).

### 2. Point the DNS A Record to the Origin

1. In Cloudflare DNS, find the `A` record for your root domain (`@`) or subdomain (`www`).
2. Set the value to the droplet's public IP address (see [vps.md](vps.md)).
3. Make sure the **Proxy status** is set to **Proxied** (orange cloud icon). This routes traffic through Cloudflare.

### 3. Enable Auto Minify

1. Go to **Speed > Optimization**.
2. Under **Auto Minify**, enable **JavaScript**, **CSS**, and **HTML**.

### 4. Enable Polish (Automatic WebP Delivery)

1. Go to **Speed > Optimization**.
2. Under **Polish**, select **Lossless** or **Lossy** (Lossless is safer for hero images; Lossy gives better compression for photos).
3. Toggle on **WebP** conversion so modern browsers automatically receive WebP images.

> **Note:** Polish is only available on Pro plan and above. On the free tier, WebP images are already served by the application (the image optimizer pipeline generates `.webp` srcset variants), so Polish is an optional enhancement.

### 5. Cache HTML Responses with a Page Rule

Adding a short cache TTL for HTML lets Cloudflare serve repeat visitors from edge nodes, reducing origin load and TTFB.

1. Go to **Rules > Page Rules** and click **Create Page Rule**.
2. URL pattern: `yourdomain.com/*`
3. Setting: **Cache Level** → **Standard**
4. Add another setting: **Edge Cache TTL** → **30 seconds**
5. Save and deploy.

Alternatively, use **Cache Rules** (the newer interface):
1. **Rules > Cache Rules** → **Create rule**.
2. Condition: hostname equals `yourdomain.com`.
3. Cache eligibility: **Eligible for cache**.
4. Edge TTL: Override to **30 seconds**.

> 30 seconds is a safe starting value. Marketing pages that change rarely can tolerate longer TTLs (e.g. 5 minutes). Do not cache authenticated or personalised pages.

### 6. Verify

After DNS propagation (up to 24 hours, usually much faster):

- Open the deployed URL and inspect response headers. You should see `cf-cache-status: HIT` on repeated requests.
- Run a [PageSpeed Insights](https://pagespeed.web.dev/) mobile test. LCP should improve due to:
  - Reduced TTFB from Cloudflare edge caching
  - Compressed/minified assets
  - WebP images served automatically (Pro tier)

## Summary of Settings to Enable

| Setting | Location | Value |
|---|---|---|
| DNS Proxy | DNS Records | Proxied (orange cloud) |
| Auto Minify JS | Speed > Optimization | On |
| Auto Minify CSS | Speed > Optimization | On |
| Auto Minify HTML | Speed > Optimization | On |
| Polish | Speed > Optimization | Lossless (Pro+) |
| WebP | Speed > Optimization | On (Pro+) |
| Edge Cache TTL | Rules > Cache Rules | 30 seconds |
