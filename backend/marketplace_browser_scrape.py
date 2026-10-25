"""
HTTP-based marketplace price extraction — no Playwright/browser required.

Uses only Python's built-in urllib so no extra packages or browser install
are needed on Render (or any other host).

Strategy per marketplace
------------------------
Lazada
  1. Parse price from URL query params (?price= / priceCompare=...displayPrice:N...)
  2. Fetch page HTML -> og/product meta tags -> JSON-LD Product schema
  3. Regex scan page HTML for peso amounts

Shopee
  1. Visit product page to collect session cookies (HTTPCookieProcessor)
  2. Call Shopee's internal /api/v4/item/get with those cookies attached
  3. Parse __NEXT_DATA__ JSON blob embedded in page HTML
  4. og/product meta tags -> peso text scan
"""

from __future__ import annotations

import gzip
import http.cookiejar
import json
import re
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse
import urllib.request
import urllib.error

TIMEOUT_SECS = 25

# ---------------------------------------------------------------------------
# Shared HTTP helpers
# ---------------------------------------------------------------------------

_COMMON_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-PH,en-US;q=0.9,en;q=0.8",
    # Omit br so we only need to handle gzip (no brotli library needed)
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

_JSON_HEADERS = {
    **_COMMON_HEADERS,
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
}


def _build_opener() -> urllib.request.OpenerDirector:
    """Build an opener that automatically stores and forwards cookies."""
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPSHandler(),
    )


def _fetch(
    url: str,
    opener: urllib.request.OpenerDirector,
    extra_headers: dict[str, str] | None = None,
) -> str | None:
    """Fetch URL and return decoded text body."""
    headers = {**_COMMON_HEADERS, **(extra_headers or {})}
    req = urllib.request.Request(url, headers=headers)
    try:
        with opener.open(req, timeout=TIMEOUT_SECS) as resp:
            raw = resp.read()
            encoding = resp.headers.get("Content-Encoding", "")
            if encoding.lower() == "gzip":
                raw = gzip.decompress(raw)
            ct = resp.headers.get("Content-Type", "")
            charset = "utf-8"
            if "charset=" in ct:
                charset = ct.split("charset=")[-1].strip().split(";")[0].strip() or "utf-8"
            return raw.decode(charset, errors="replace")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Generic HTML price/title extraction helpers
# ---------------------------------------------------------------------------

def _meta_price(html: str) -> float:
    """og:price:amount / product:price:amount meta tag."""
    for pat in (
        r'<meta\s[^>]*property=["\']product:price:amount["\']\s[^>]*content=["\']([\d,.]+)["\']',
        r'<meta\s[^>]*content=["\']([\d,.]+)["\']\s[^>]*property=["\']product:price:amount["\']',
        r'<meta\s[^>]*property=["\']og:price:amount["\']\s[^>]*content=["\']([\d,.]+)["\']',
        r'<meta\s[^>]*content=["\']([\d,.]+)["\']\s[^>]*property=["\']og:price:amount["\']',
    ):
        m = re.search(pat, html, re.IGNORECASE | re.DOTALL)
        if m:
            try:
                v = float(m.group(1).replace(",", ""))
                if 1 <= v <= 5_000_000:
                    return v
            except ValueError:
                pass
    return 0.0


def _json_ld_price_title(html: str) -> tuple[float, str]:
    """JSON-LD Product schema -> (price, name)."""
    best_price = 0.0
    best_name = ""
    for script in re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.DOTALL | re.IGNORECASE,
    ):
        try:
            data = json.loads(script)
            nodes = data if isinstance(data, list) else [data]
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                name = node.get("name")
                if isinstance(name, str) and name.strip():
                    best_name = name.strip()
                offers = node.get("offers")
                off = offers[0] if isinstance(offers, list) and offers else offers
                raw = (off or {}).get("price") if isinstance(off, dict) else node.get("price")
                if raw is not None:
                    p = float(str(raw).replace(",", ""))
                    if 1 <= p <= 5_000_000:
                        best_price = p
                        break
        except Exception:
            pass
    return best_price, best_name


def _html_title(html: str) -> str:
    m = re.search(r"<h1[^>]*>([^<]+)</h1>", html, re.IGNORECASE)
    if m:
        return re.sub(r"<[^>]+>", "", m.group(1)).strip()
    m = re.search(
        r'<meta\s[^>]*property=["\']og:title["\']\s[^>]*content=["\'](.*?)["\']',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    if m:
        return m.group(1).strip()
    return ""


def _peso_scan(html: str) -> float:
    """Last-resort: scan visible text for peso amounts."""
    found: list[float] = []
    for m in re.finditer(
        r"(?:\u20b1|PHP)\s*([\d,]+(?:\.\d{1,2})?)", html[:12_000]
    ):
        try:
            v = float(m.group(1).replace(",", ""))
            if 1 <= v < 1_000_000:
                found.append(v)
        except ValueError:
            pass
    if not found:
        return 0.0
    if len(found) == 1:
        return found[0]
    uniq = sorted(set(found))
    return uniq[len(uniq) // 2]  # median to avoid outliers


# ===========================================================================
# LAZADA
# ===========================================================================

def _lazada_price_from_url(url: str) -> float:
    """
    Lazada embeds the price in URL query params.
    ?price=138   ->  138.00 PHP
    ?priceCompare=...displayPrice:13800...  ->  13800 centavos -> 138.00 PHP
    """
    try:
        u = urlparse(url)
        qs = parse_qs(u.query)

        direct = qs.get("price", [""])[0]
        if direct:
            p = float(direct.replace(",", ""))
            if 1 <= p <= 500_000:
                return round(p, 2)

        pc = qs.get("priceCompare", [""])[0]
        if pc:
            decoded = unquote(pc)
            for name in ("displayPrice", "originPrice"):
                m = re.search(rf"(?:^|[;:]){name}:(\d+)", decoded, re.IGNORECASE)
                if m:
                    v = int(m.group(1))
                    major = v / 100 if v >= 1000 else float(v)
                    if 1 <= major <= 500_000:
                        return round(major, 2)
    except Exception:
        pass
    return 0.0


def _lazada_sku_from_url(url: str) -> str | None:
    try:
        path = urlparse(url).path
        m = re.search(r"-s(\d+)\.html", path)
        if m:
            return m.group(1)
        qs = parse_qs(urlparse(url).query)
        for k in ("sku_id", "skuId", "skuid"):
            if k in qs:
                return qs[k][0]
    except Exception:
        pass
    return None


def scrape_lazada_sync(url: str) -> tuple[bool, str | None, str | None]:
    if "lazada." not in urlparse(url).netloc.lower():
        return False, None, "URL does not look like a Lazada storefront link."

    price = 0.0
    title = ""

    # Step 1 — price from URL (fastest, no network request needed)
    price = _lazada_price_from_url(url)

    # Step 2 — fetch page HTML for title + possible price fallback
    opener = _build_opener()
    html = _fetch(url, opener)
    if html:
        if not title:
            title = _html_title(html)
        if price <= 0:
            price = _meta_price(html)
        if price <= 0:
            jld_p, jld_n = _json_ld_price_title(html)
            price = jld_p
            if not title:
                title = jld_n
        if price <= 0:
            price = _peso_scan(html)

    if price <= 0:
        return (
            False,
            None,
            "Could not extract a price from this Lazada URL. "
            "Paste the full product page URL (it should contain ?price= in the address bar), "
            "or use Advanced -> paste JSON.",
        )

    payload: dict[str, Any] = {
        "price": price,
        "title": title,
        "_pricewise_source": "dom_fallback",
        "_pricewisePageUrl": url,
    }
    sku = _lazada_sku_from_url(url)
    if sku:
        payload["selectedSkuId"] = sku

    return True, json.dumps(payload), None


# ===========================================================================
# SHOPEE
# ===========================================================================

def _shopee_ids(url: str) -> tuple[str | None, str | None, str | None]:
    """Return (shop_id, item_id, origin) from a Shopee product URL."""
    try:
        u = urlparse(url.strip())
        if "shopee." not in u.netloc.lower():
            return None, None, None
        path = u.path.rstrip("/")
        origin = f"{u.scheme}://{u.netloc}"

        # /product-name-i.SHOPID.ITEMID
        m = re.search(r"-i\.(\d+)\.(\d+)$", path) or re.search(r"\.i\.(\d+)\.(\d+)$", path)
        if m:
            return m.group(1), m.group(2), origin

        # /product/SHOPID/ITEMID
        m2 = re.search(r"/product/(\d+)/(\d+)", path)
        if m2:
            return m2.group(1), m2.group(2), origin

    except Exception:
        pass
    return None, None, None


def _shopee_api(
    shop_id: str,
    item_id: str,
    origin: str,
    referer: str,
    opener: urllib.request.OpenerDirector,
) -> dict[str, Any] | None:
    """Call Shopee's internal item/get API endpoint (cookies from page visit are used)."""
    api_url = f"{origin}/api/v4/item/get?itemid={item_id}&shopid={shop_id}"
    headers = {
        **_JSON_HEADERS,
        "Referer": referer,
        "Accept": "application/json, text/plain, */*",
    }
    req = urllib.request.Request(api_url, headers=headers)
    try:
        with opener.open(req, timeout=TIMEOUT_SECS) as resp:
            raw = resp.read()
            encoding = resp.headers.get("Content-Encoding", "")
            if encoding.lower() == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", errors="replace"))
    except Exception:
        return None


def _shopee_price_from_api(data: dict[str, Any]) -> tuple[float, str]:
    """Extract (price_peso, name) from Shopee item/get API response."""
    item = None
    d = data.get("data")
    if isinstance(d, dict):
        item = d.get("item")
    if not item:
        item = data.get("item")
    if not isinstance(item, dict):
        return 0.0, ""

    name = item.get("name", "")
    for k in ("price_min", "price_max", "price", "item_price"):
        v = item.get(k)
        if isinstance(v, (int, float)) and v > 0:
            # Shopee stores prices as peso x 100_000
            peso = v / 100_000
            if peso < 0.01:
                peso = v  # already in pesos
            return round(peso, 2), str(name)

    return 0.0, str(name)


def _shopee_next_data_price(html: str) -> tuple[float, str]:
    """Extract price from embedded __NEXT_DATA__ JSON blob."""
    m = re.search(
        r'<script\s+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not m:
        return 0.0, ""
    try:
        nd = json.loads(m.group(1))
        price = _walk_shopee_price(nd)
        name = _walk_key(nd, "name")
        if price and price > 0:
            peso = price / 100_000
            return round(peso, 2), str(name) if name else ""
    except Exception:
        pass
    return 0.0, ""


def _walk_shopee_price(obj: Any, depth: int = 0) -> float | None:
    if depth > 14:
        return None
    if isinstance(obj, dict):
        for k in ("price_min", "price_max", "price"):
            v = obj.get(k)
            # Encoded as integer x 100_000 so valid prices are > 100_000
            if isinstance(v, (int, float)) and v > 100_000:
                return float(v)
        for v in obj.values():
            r = _walk_shopee_price(v, depth + 1)
            if r:
                return r
    elif isinstance(obj, list):
        for el in obj:
            r = _walk_shopee_price(el, depth + 1)
            if r:
                return r
    return None


def _walk_key(obj: Any, key: str, depth: int = 0) -> str | None:
    if depth > 14:
        return None
    if isinstance(obj, dict):
        v = obj.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
        for val in obj.values():
            r = _walk_key(val, key, depth + 1)
            if r:
                return r
    elif isinstance(obj, list):
        for el in obj:
            r = _walk_key(el, key, depth + 1)
            if r:
                return r
    return None


def _peso_int(peso: float) -> int:
    return int(round(peso * 100_000))


def scrape_shopee_sync(url: str) -> tuple[bool, str | None, str | None]:
    shop_id, item_id, origin = _shopee_ids(url)
    if not shop_id or not item_id or not origin:
        return False, None, "Could not parse shop/item IDs from this Shopee URL."

    # One cookie-jar opener shared across the page visit + API call
    # so session cookies (SPC_CDS, csrftoken, etc.) carry over automatically.
    opener = _build_opener()

    price = 0.0
    title = ""
    api_payload: dict[str, Any] | None = None

    # Step 1 — warm up cookies by visiting the product page first
    html = _fetch(url, opener)

    # Step 2 — call Shopee's item/get API (cookies now attached)
    api_data = _shopee_api(shop_id, item_id, origin, url, opener)
    if api_data:
        p, t = _shopee_price_from_api(api_data)
        if p > 0:
            price = p
            title = t
            api_payload = api_data

    # Step 3 — __NEXT_DATA__ fallback
    if price <= 0 and html:
        price, title = _shopee_next_data_price(html)

    # Step 4 — meta / JSON-LD / peso text scan
    if price <= 0 and html:
        price = _meta_price(html)
    if price <= 0 and html:
        jld_p, jld_n = _json_ld_price_title(html)
        price = jld_p
        if not title and jld_n:
            title = jld_n
    if price <= 0 and html:
        price = _peso_scan(html)

    if price <= 0:
        return (
            False,
            None,
            "Could not extract a price from this Shopee listing. "
            "Try again or use Advanced -> paste JSON.",
        )

    if api_payload:
        return True, json.dumps(api_payload), None

    # Build a synthetic payload the frontend parsers can handle
    raw = _peso_int(price)
    payload: dict[str, Any] = {
        "data": {
            "item": {
                "itemid": int(item_id),
                "shopid": int(shop_id),
                "name": title,
                "price_min": raw,
                "price_max": raw,
            }
        },
        "_pricewise_source": "dom_fallback",
    }
    return True, json.dumps(payload), None