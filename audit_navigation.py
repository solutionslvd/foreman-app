#!/usr/bin/env python3
"""Navigation audit script for The Foreman application."""
import httpx
from bs4 import BeautifulSoup

BASE = "http://localhost:8050"

def audit_landing_page():
    """Audit the landing page navigation elements."""
    r = httpx.get(f"{BASE}/")
    soup = BeautifulSoup(r.text, 'html.parser')
    
    print("=" * 80)
    print("LANDING PAGE - NAVIGATION ELEMENT ANALYSIS")
    print("=" * 80)
    
    # Find all links
    links = soup.find_all('a', href=True)
    print(f"\nTotal LINKS FOUND: {len(links)}")
    print("-" * 80)
    
    internal_links = []
    external_links = []
    hash_links = []
    javascript_links = []
    
    for link in links:
        href = link.get('href', '')
        text = link.get_text(strip=True)[:40] or "[no text]"
        
        if href.startswith('javascript:') or href == '#':
            onclick = link.get('onclick', '')
            javascript_links.append((href, text, onclick))
        elif href.startswith('#'):
            hash_links.append((href, text))
        elif href.startswith('http://') or href.startswith('https://'):
            external_links.append((href, text))
        elif href.startswith('/'):
            try:
                test = httpx.get(f"{BASE}{href}", follow_redirects=False, timeout=3)
                status = test.status_code
                internal_links.append((href, text, status))
            except Exception as e:
                internal_links.append((href, text, f"ERROR: {e}"))
        else:
            internal_links.append((href, text, "?"))
    
    print("\n[INTERNAL LINKS] (starting with /):")
    for href, text, status in internal_links:
        icon = "[OK]" if status == 200 else "[WARN]" if status in [401, 403] else "[FAIL]"
        print(f"  {icon} {href:35} -> {status} ({text})")
    
    print("\n[EXTERNAL LINKS]:")
    for href, text in external_links:
        print(f"  [LINK] {href:50} ({text})")
    
    print("\n[HASH LINKS] (same-page anchors):")
    for href, text in hash_links:
        target_id = href[1:]  # Remove #
        target = soup.find(id=target_id)
        icon = "[OK]" if target else "[MISSING]"
        found = 'TARGET FOUND' if target else 'TARGET MISSING!'
        print(f"  {icon} {href:20} -> #{target_id:20} ({text}) {found}")
    
    print("\n[JAVASCRIPT/ACTION LINKS]:")
    for href, text, onclick in javascript_links:
        onclick_display = onclick[:50] + "..." if len(onclick) > 50 else onclick
        print(f"  [JS] {text:30} onclick='{onclick_display}'")
    
    # Find all buttons
    buttons = soup.find_all('button')
    print(f"\n\nBUTTONS FOUND: {len(buttons)}")
    print("-" * 80)
    for btn in buttons:
        onclick = btn.get('onclick', '')
        text = btn.get_text(strip=True)[:40] or "[no text]"
        onclick_display = onclick[:50] + "..." if len(onclick) > 50 else onclick
        print(f"  [BTN] {text:30} onclick='{onclick_display}'")
    
    return {
        'internal_links': internal_links,
        'hash_links': hash_links,
        'buttons': [(btn.get_text(strip=True), btn.get('onclick', '')) for btn in buttons]
    }

def audit_app_page():
    """Audit the main app page navigation elements."""
    r = httpx.get(f"{BASE}/app")
    soup = BeautifulSoup(r.text, 'html.parser')
    
    print("\n" + "=" * 80)
    print("APP PAGE - NAVIGATION ELEMENT ANALYSIS")
    print("=" * 80)
    
    # Find all navigation items with data-page
    nav_items = soup.find_all(attrs={"data-page": True})
    print(f"\nNAV ITEMS (sidebar navigation): {len(nav_items)}")
    print("-" * 80)
    
    # Get unique page names
    pages = set()
    for item in nav_items:
        page = item.get('data-page')
        pages.add(page)
        onclick = item.get('onclick', '')
        text = item.get_text(strip=True)[:30]
        print(f"  [NAV] data-page='{page}' onclick='{onclick}' ({text})")
    
    # Check if corresponding page divs exist
    print(f"\nPAGE CONTAINERS (divs with id='page-XXX'):")
    print("-" * 80)
    
    for page in sorted(pages):
        page_div = soup.find(id=f"page-{page}")
        icon = "[OK]" if page_div else "[MISSING!]"
        print(f"  {icon} page-{page:25} {'EXISTS' if page_div else 'NOT FOUND'}")
    
    # Find all onclick handlers that call navigateTo
    print(f"\nNAVIGATETO CALLS:")
    print("-" * 80)
    
    all_elements = soup.find_all(onclick=True)
    navigate_calls = []
    for el in all_elements:
        onclick = el.get('onclick', '')
        if 'navigateTo' in onclick:
            text = el.get_text(strip=True)[:30] or el.name
            navigate_calls.append((onclick, text))
    
    for onclick, text in navigate_calls[:30]:  # Limit output
        print(f"  [CALL] {text:30} -> {onclick[:60]}")
    
    return {
        'nav_items': list(pages),
        'navigate_calls': navigate_calls
    }

if __name__ == "__main__":
    audit_landing_page()
    audit_app_page()