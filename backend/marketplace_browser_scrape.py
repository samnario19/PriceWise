"""
Browser-based marketplace capture using Playwright (real Chromium session).

Uses the **sync** Playwright API and runs it in a worker thread from FastAPI.
The async Playwright API often raises NotImplementedError on Windows inside Uvicorn.

Anti-bot mitigations applied:
  - navigator.webdriver patched to undefined before page scripts run
  - chrome.runtime stub injected so feature-detection passes
  - Randomised viewport, realistic Accept-Language / platform headers
  - Human-like scroll on page load to trigger lazy-loaded price containers
  - Lazada: wait for network idle so MTOP/ACS XHRs finish, then extract
    window.__moduleData__ / window.pageData / window.__INIT_DATA__
  - Shopee: multiple capture paths (XHR hook → context.request → in-page
    fetch → window.__INITIAL_STATE__ → DOM text fallback)
"""

from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import urlparse

PAGE_TIMEOUT_MS = 60_000   # increased for slower cloud environments
EXTRA_WAIT_MS   = 6_000    # wait after domcontentloaded so XHRs fire

# ---------------------------------------------------------------------------
# Stealth injection – paste into every new page before navigation
# ---------------------------------------------------------------------------
_STEALTH_INIT_SCRIPT = """
() => {
    // 1. Hide webdriver flag
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

    // 2. Stub chrome runtime so sites don't see a "missing" chrome object
    if (!window.chrome) {
        window.chrome = {runtime: {}};
    }

    // 3. Spoof plugins length (headless Chromium has 0 plugins)
    Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});

    // 4. Spoof languages
    Object.defineProperty(navigator, 'languages', {get: () => ['en-PH', 'en-US', 'en']});

    // 5. Spoof platform
    Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});

    // 6. Remove headless-only properties
    delete navigator.__proto__.webdriver;
}
"""

_HUMAN_SCROLL_SCRIPT = """
async () => {
    await new Promise(resolve => {
        let total = 0;
        const step = 120;
        const timer = setInterval(() => {
            window.scrollBy(0, step);
            total += step;
            if (total >= Math.min(document.body.scrollHeight * 0.6, 2400)) {
                clearInterval(timer);
                resolve();
            }
        }, 80);
    });
}
"""

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_browser_args() -> list[str]:
    return [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
        "--flag-switches-begin",
        "--disable-site-isolation-trials",
        "--flag-switches-end",
    ]


def _make_context_kwargs() -> dict[str, Any]:
    return dict(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
        locale="en-PH",
        timezone_id="Asia/Manila",
        viewport={"width": 1366, "height": 768},
        extra_http_headers={
            "Accept-Language": "en-PH,en-US;q=0.9,en;q=0.8",
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/avif,image/webp,image/apng,*/*;q=0.8"
            ),
            "sec-ch-ua": (
                '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"'
            ),
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
        },
    )


# ===========================================================================
# SHOPEE
# ===========================================================================

def _shopee_xhr_looks_like_product_api(rurl: str) -> bool:
    """Shopee renames routes; accept common PDP / item JSON endpoints."""
    if "shopee" not in rurl and "api/v4" not in rurl and "api/v2" not in rurl:
        return False
    return any(
        m in rurl
        for m in (
            "item/get",
            "pdp/get",
            "get_pc",
            "get_pc_item",
            "item/detail",
            "get_item",
        )
    )


def _parse_shopee_listing_ids(url: str) -> tuple[str | None, str | None, str | None]:
    try:
        u = urlparse(url.strip())
        if "shopee." not in u.netloc.lower():
            return None, None, None
        path = u.path.rstrip("/")
        m = re.search(r"-i\.(\d+)\.(\d+)$", path) or re.search(r"\.i\.(\d+)\.(\d+)$", path)
        if not m:
            return None, None, None
        shop_id, item_id = m.group(1), m.group(2)
        origin = f"{u.scheme}://{u.netloc}"
        return shop_id, item_id, origin
    except Exception:
        return None, None, None


def _dict_looks_like_shopee_item(d: dict[str, Any]) -> bool:
    """Align with frontend looksLikeShopeeItem (itemid + price/name/tiers)."""
    raw_id = d.get("itemid")
    if raw_id is None:
        raw_id = d.get("item_id")
    has_id = isinstance(raw_id, (int, float)) or (
        isinstance(raw_id, str) and raw_id.isdigit()
    )
    if not has_id:
        return False
    return (
        isinstance(d.get("name"), str)
        or isinstance(d.get("price_min"), (int, float))
        or isinstance(d.get("price_max"), (int, float))
        or isinstance(d.get("price"), (int, float))
        or isinstance(d.get("tier_variations"), list)
        or d.get("price_info") is not None
    )


def _walk_find_item_like(obj: Any, depth: int = 0) -> dict[str, Any] | None:
    """Best-effort find object that looks like Shopee item/get item payload."""
    if depth > 18:
        return None
    if isinstance(obj, dict):
        if _dict_looks_like_shopee_item(obj):
            return obj
        nested = obj.get("item")
        if isinstance(nested, dict) and _dict_looks_like_shopee_item(nested):
            return nested
        for v in obj.values():
            hit = _walk_find_item_like(v, depth + 1)
            if hit:
                return hit
    elif isinstance(obj, list):
        for el in obj:
            hit = _walk_find_item_like(el, depth + 1)
            if hit:
                return hit
    return None


def _score_shopee_payload(obj: Any) -> int:
    """Prefer captures that contain a usable item; deprioritize error-only blobs."""
    if not isinstance(obj, dict):
        return 0
    if _walk_find_item_like(obj):
        return 100
    data = obj.get("data")
    if isinstance(data, dict) and isinstance(data.get("item"), dict):
        return 90
    err = obj.get("error")
    if err not in (None, 0, "error_none", "") and data is None:
        return -10
    return 5


def _pick_best_shopee_payload(objs: list[Any]) -> Any | None:
    if not objs:
        return None
    best: Any | None = None
    best_score = -9999
    best_i = -1
    for i, o in enumerate(objs):
        s = _score_shopee_payload(o)
        if s > best_score or (s == best_score and i > best_i):
            best_score = s
            best = o
            best_i = i
    return best


def _item_has_positive_list_price(item: dict[str, Any]) -> bool:
    for k in ("price_min", "price_max", "price", "item_min_price", "item_price"):
        v = item.get(k)
        if isinstance(v, (int, float)) and v > 0:
            return True
    pi = item.get("price_info")
    if isinstance(pi, dict):
        pr = pi.get("price")
        if isinstance(pr, (int, float)) and pr > 0:
            return True
    tiers = item.get("tier_variations")
    if isinstance(tiers, list):
        for t in tiers:
            if isinstance(t, dict):
                pr = t.get("price") or t.get("price_min")
                if isinstance(pr, (int, float)) and pr > 0:
                    return True
    return False


def _shopee_payload_usable_for_import(obj: Any) -> bool:
    if obj is None:
        return False
    if not isinstance(obj, dict):
        return False
    hit = _walk_find_item_like(obj)
    if hit and _item_has_positive_list_price(hit):
        return True
    data = obj.get("data")
    if isinstance(data, dict):
        item = data.get("item")
        if isinstance(item, dict) and _item_has_positive_list_price(item):
            return True
    return False


def _peso_float_to_shopee_price_int(peso: float) -> int:
    return int(round(peso * 100_000))


def _synthetic_item_get_payload(
    shop_id: str | None, item_id: str | None, title: str, price_peso: float
) -> dict[str, Any]:
    raw = _peso_float_to_shopee_price_int(price_peso)
    iid = int(item_id) if item_id and str(item_id).isdigit() else 0
    sid = int(shop_id) if shop_id and str(shop_id).isdigit() else 0
    return {
        "data": {
            "item": {
                "itemid": iid,
                "shopid": sid,
                "name": title or "Shopee listing",
                "price_min": raw,
                "price_max": raw,
            }
        },
        "_pricewise_source": "dom_fallback",
    }


def _try_inpage_item_get(page: Any, origin: str, item_id: str, shop_id: str) -> Any | None:
    """Same-origin fetch inside the page (often succeeds when context.request is blocked)."""
    try:
        return page.evaluate(
            """async ([origin, itemId, shopId]) => {
                try {
                    const u = new URL(origin + '/api/v4/item/get');
                    u.searchParams.set('itemid', String(itemId));
                    u.searchParams.set('shopid', String(shopId));
                    const r = await fetch(u.toString(), {
                        credentials: 'include',
                        headers: {
                            accept: 'application/json',
                            'x-requested-with': 'XMLHttpRequest',
                        },
                    });
                    const ct = (r.headers.get('content-type') || '').toLowerCase();
                    if (!ct.includes('json')) return null;
                    return await r.json();
                } catch (e) {
                    return null;
                }
            }""",
            [origin, item_id, shop_id],
        )
    except Exception:
        return None


def _extract_dom_price_title(page: Any) -> dict[str, Any] | None:
    """Read listing title and ₱ price from visible page / JSON-LD / meta when APIs error."""
    try:
        out = page.evaluate(
            """() => {
                const result = { title: '', pricePeso: null };
                const t1 = document.querySelector('h1');
                if (t1 && t1.innerText) result.title = t1.innerText.trim();
                if (!result.title) {
                    const og = document.querySelector('meta[property="og:title"]');
                    if (og) result.title = (og.getAttribute('content') || '').trim();
                }
                const metaPrice =
                    document.querySelector('meta[property="product:price:amount"]') ||
                    document.querySelector('meta[property="og:price:amount"]');
                if (metaPrice) {
                    const s = metaPrice.getAttribute('content');
                    const v = parseFloat(String(s || '').replace(/,/g, ''));
                    if (!isNaN(v) && v > 0) result.pricePeso = v;
                }
                if (result.pricePeso == null) {
                    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    for (const sc of scripts) {
                        try {
                            const j = JSON.parse(sc.textContent || '{}');
                            const nodes = Array.isArray(j) ? j : [j];
                            for (const node of nodes) {
                                if (!node || typeof node !== 'object') continue;
                                const offers = node.offers;
                                const off = Array.isArray(offers) ? offers[0] : offers;
                                let p = off && off.price != null ? off.price : node.price;
                                if (typeof p === 'string') p = parseFloat(p.replace(/,/g, ''));
                                if (typeof p === 'number' && !isNaN(p) && p > 0) {
                                    result.pricePeso = p;
                                    break;
                                }
                            }
                            if (result.pricePeso != null) break;
                        } catch (e) {}
                    }
                }
                if (result.pricePeso == null) {
                    const body = document.body ? document.body.innerText : '';
                    const head = body.slice(0, 8000);
                    const re = /(?:₱|\\u20b1|PHP|P)\\s*([\\d,]+(?:\\.\\d{1,2})?)/gi;
                    let m;
                    const found = [];
                    while ((m = re.exec(head)) !== null) {
                        const v = parseFloat(m[1].replace(/,/g, ''));
                        if (!isNaN(v) && v >= 1 && v < 100000000) found.push(v);
                    }
                    if (found.length === 1) result.pricePeso = found[0];
                    else if (found.length > 1) {
                        const uniq = [...new Set(found)].sort((a, b) => a - b);
                        result.pricePeso = uniq[Math.floor(uniq.length / 2)];
                    }
                }
                return result;
            }"""
        )
        if not isinstance(out, dict):
            return None
        price = out.get("pricePeso")
        title = out.get("title") if isinstance(out.get("title"), str) else ""
        if isinstance(price, (int, float)) and price > 0:
            return {"title": title or "", "price_peso": float(price)}
        return None
    except Exception:
        return None


def scrape_shopee_sync(url: str) -> tuple[bool, str | None, str | None]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False, None, "Playwright is not installed. Run: pip install playwright && playwright install chromium"

    captured: list[Any] = []
    payload: Any | None = None

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=_make_browser_args(),
        )
        try:
            context = browser.new_context(**_make_context_kwargs())

            # Apply stealth on every new page automatically
            context.add_init_script(_STEALTH_INIT_SCRIPT)

            page = context.new_page()

            def on_response(response) -> None:
                try:
                    rurl = response.url.lower()
                    if response.status != 200:
                        return
                    if not _shopee_xhr_looks_like_product_api(rurl):
                        return
                    ct = (response.headers.get("content-type") or "").lower()
                    if "json" not in ct:
                        return
                    payload = response.json()
                    captured.append(payload)
                except Exception:
                    return

            page.on("response", on_response)

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT_MS)
                page.wait_for_timeout(EXTRA_WAIT_MS)
            except Exception as exc:
                return False, None, f"Navigation failed: {exc!s}"

            # Human-like scroll to trigger lazy-loaded price elements
            try:
                page.evaluate(_HUMAN_SCROLL_SCRIPT)
                page.wait_for_timeout(1500)
            except Exception:
                pass

            shop_id, item_id, origin = _parse_shopee_listing_ids(url)
            # Cookie-aware fetch often succeeds when XHR hooks miss or return errors first.
            if shop_id and item_id and origin:
                try:
                    api_res = context.request.get(
                        f"{origin}/api/v4/item/get",
                        params={"itemid": item_id, "shopid": shop_id},
                        headers={
                            "Referer": url,
                            "Accept": "application/json",
                            "x-requested-with": "XMLHttpRequest",
                        },
                        timeout=25_000,
                    )
                    if api_res.ok:
                        ct = (api_res.headers.get("content-type") or "").lower()
                        if "json" in ct:
                            captured.append(api_res.json())
                except Exception:
                    pass

            if shop_id and item_id and origin:
                inpage = _try_inpage_item_get(page, origin, item_id, shop_id)
                if inpage:
                    captured.append(inpage)

            # Always try embedded state — previously skipped when item/get returned an error JSON only.
            try:
                raw_state = page.evaluate(
                    """() => {
                        try {
                            return typeof window.__INITIAL_STATE__ !== 'undefined'
                                ? window.__INITIAL_STATE__
                                : null;
                        } catch (e) { return null; }
                    }"""
                )
                if raw_state:
                    item_like = _walk_find_item_like(raw_state)
                    if item_like:
                        captured.append({"data": {"item": item_like}})
            except Exception:
                pass

            if not captured and shop_id and item_id and origin:
                api_url = f"{origin}/api/v4/item/get?itemid={item_id}&shopid={shop_id}"
                try:
                    api_page = context.new_page()
                    api_page.set_extra_http_headers({"Referer": url, "Accept": "application/json"})
                    api_page.goto(api_url, wait_until="domcontentloaded", timeout=25_000)
                    api_page.wait_for_timeout(1200)
                    txt = api_page.evaluate("() => document.body ? document.body.innerText.trim() : ''")
                    if txt:
                        captured.append(json.loads(txt))
                    api_page.close()
                except Exception:
                    pass

            payload = _pick_best_shopee_payload(captured)
            if not _shopee_payload_usable_for_import(payload):
                page.wait_for_timeout(2000)
                dom = _extract_dom_price_title(page)
                if dom and shop_id and item_id:
                    captured.append(
                        _synthetic_item_get_payload(
                            shop_id, item_id, dom.get("title") or "", dom["price_peso"]
                        )
                    )
                    payload = _pick_best_shopee_payload(captured)
        finally:
            browser.close()

    if payload is None:
        return (
            False,
            None,
            "Could not capture Shopee listing JSON. Try again, confirm the URL is a full product page, "
            "or use Advanced → paste JSON.",
        )

    try:
        return True, json.dumps(payload), None
    except Exception as exc:
        return False, None, str(exc)


# ===========================================================================
# LAZADA
# ===========================================================================

def _lazada_xhr_looks_useful(rurl: str) -> bool:
    """Lazada PH uses MTOP, ACS, PDP modules — URL segments vary by release."""
    if "lazada" not in rurl:
        return False
    return any(
        m in rurl
        for m in (
            "product",
            "pdp",
            "mtop",
            "sku",
            "price",
            "item",
            "detail",
            "offer",
            "trade",
            "promotion",
            "gw/",
            "async",
            "bac",
            "pagecache",
            "render",
            "mtopjson",
            "h5api",
            "acs-m",
            "acs.",
            "component",
        )
    )


def _lazada_extract_page_bootstrap(page: Any) -> dict[str, Any] | None:
    """Extract window bootstrap data from Lazada page JS context."""
    try:
        bootstrap = page.evaluate(
            """() => {
                try {
                    const out = {};
                    if (typeof window.__moduleData__ !== 'undefined') out.__moduleData__ = window.__moduleData__;
                    if (typeof window.pageData !== 'undefined') out.pageData = window.pageData;
                    if (typeof window.__INIT_DATA__ !== 'undefined') out.__INIT_DATA__ = window.__INIT_DATA__;
                    if (typeof window.__data !== 'undefined') out.__data = window.__data;
                    if (typeof window.g_config !== 'undefined') out.g_config = window.g_config;
                    return Object.keys(out).length > 0 ? out : null;
                } catch (e) {
                    return null;
                }
            }"""
        )
        return bootstrap if isinstance(bootstrap, dict) else None
    except Exception:
        return None


def _lazada_extract_next_data(page: Any) -> dict[str, Any] | None:
    """Try extracting __NEXT_DATA__ script tag which Lazada sometimes uses."""
    try:
        result = page.evaluate(
            """() => {
                try {
                    const el = document.getElementById('__NEXT_DATA__');
                    if (el && el.textContent) return JSON.parse(el.textContent);
                    return null;
                } catch(e) { return null; }
            }"""
        )
        return result if isinstance(result, dict) else None
    except Exception:
        return None


def _lazada_extract_from_page_source(page: Any) -> list[dict[str, Any]]:
    """
    Extract JSON blobs embedded in <script> tags in the page source.
    Lazada embeds product data inside script tags as window.__moduleData__ = {...}
    """
    captured: list[dict[str, Any]] = []
    try:
        scripts_text: list[str] = page.evaluate(
            """() => {
                const scripts = [];
                document.querySelectorAll('script').forEach(s => {
                    if (s.textContent && s.textContent.length > 100) {
                        scripts.push(s.textContent);
                    }
                });
                return scripts;
            }"""
        )
        for script in scripts_text:
            # Look for window.pageData = {...}
            patterns = [
                r"window\.__moduleData__\s*=\s*(\{.+?\});?\s*(?:window\.|var |let |const |$)",
                r"window\.pageData\s*=\s*(\{.+?\});?\s*(?:window\.|var |let |const |$)",
                r"window\.__INIT_DATA__\s*=\s*(\{.+?\});?\s*(?:window\.|var |let |const |$)",
                r"var\s+__moduleData__\s*=\s*(\{.+?\});",
            ]
            for pat in patterns:
                m = re.search(pat, script, re.DOTALL)
                if m:
                    try:
                        obj = json.loads(m.group(1))
                        if isinstance(obj, dict) and obj:
                            captured.append(obj)
                    except Exception:
                        pass
    except Exception:
        pass
    return captured


def scrape_lazada_sync(url: str) -> tuple[bool, str | None, str | None]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False, None, "Playwright is not installed. Run: pip install playwright && playwright install chromium"

    if "lazada." not in urlparse(url).netloc.lower():
        return False, None, "URL does not look like a Lazada storefront link."

    captured: list[Any] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=_make_browser_args(),
        )
        try:
            context = browser.new_context(**_make_context_kwargs())

            # Apply stealth on every new page automatically
            context.add_init_script(_STEALTH_INIT_SCRIPT)

            page = context.new_page()

            def on_response(response) -> None:
                try:
                    if response.status != 200:
                        return
                    rurl = response.url.lower()
                    if not _lazada_xhr_looks_useful(rurl):
                        return
                    ct = (response.headers.get("content-type") or "").lower()
                    if "json" not in ct:
                        return
                    payload = response.json()
                    if isinstance(payload, dict) and payload:
                        captured.append(payload)
                except Exception:
                    return

            page.on("response", on_response)

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT_MS)
                page.wait_for_timeout(EXTRA_WAIT_MS)
            except Exception as exc:
                return False, None, f"Navigation failed: {exc!s}"

            # Human-like scroll to trigger lazy-loaded price elements
            try:
                page.evaluate(_HUMAN_SCROLL_SCRIPT)
                page.wait_for_timeout(2000)
            except Exception:
                pass

            # Try additional wait for network to settle (MTOP XHRs are async)
            try:
                page.wait_for_load_state("networkidle", timeout=8_000)
            except Exception:
                pass

            # Path 1: JS window bootstrap objects
            bootstrap = _lazada_extract_page_bootstrap(page)
            if bootstrap and isinstance(bootstrap, dict):
                has_any = any(
                    bootstrap.get(k) is not None
                    for k in ("__moduleData__", "pageData", "__INIT_DATA__", "__data", "g_config")
                )
                if has_any:
                    captured.append({"_lazadaPageBootstrap": bootstrap})

            # Path 2: __NEXT_DATA__ if present
            next_data = _lazada_extract_next_data(page)
            if next_data:
                captured.append({"_lazadaNextData": next_data})

            # Path 3: inline script tag scanning (regex fallback)
            script_blobs = _lazada_extract_from_page_source(page)
            for blob in script_blobs:
                captured.append({"_lazadaPageBootstrap": blob})

            # Path 4: DOM fallback (meta/JSON-LD/₱ text scan)
            if not captured:
                dom = _extract_dom_price_title(page)
                if dom and dom.get("price_peso"):
                    captured.append(
                        {
                            "price": dom["price_peso"],
                            "title": dom.get("title") or "",
                            "_pricewise_source": "dom_fallback",
                        }
                    )
            else:
                # Even if we have bootstrap data, also try DOM for title/price cross-check
                dom = _extract_dom_price_title(page)
                if dom and dom.get("price_peso"):
                    captured.append(
                        {
                            "price": dom["price_peso"],
                            "title": dom.get("title") or "",
                            "_pricewise_source": "dom_fallback",
                        }
                    )
        finally:
            browser.close()

    if not captured:
        return (
            False,
            None,
            "Could not capture Lazada product JSON. The page may be blocking automated access. "
            "Try another listing URL or use Advanced → paste JSON manually.",
        )

    # Prefer bootstrap payload; fall back to last captured
    payload: Any | None = None
    for c in captured:
        if isinstance(c, dict) and "_lazadaPageBootstrap" in c:
            payload = c
            break
    if payload is None:
        for c in captured:
            if isinstance(c, dict) and "_lazadaNextData" in c:
                payload = c
                break
    if payload is None:
        payload = captured[-1]

    if isinstance(payload, dict):
        payload["_pricewisePageUrl"] = url

    # If we only got dom_fallback and nothing better, still try to use it
    if (
        payload is not None
        and isinstance(payload, dict)
        and payload.get("_pricewise_source") == "dom_fallback"
        and not payload.get("_lazadaPageBootstrap")
    ):
        pass  # dom_fallback is valid — frontend parseLazadaProductJson handles it

    try:
        return True, json.dumps(payload), None
    except Exception as exc:
        return False, None, str(exc)