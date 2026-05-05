"""
Generate a sample test PDF for the Dezzy Check Splitter.

Output: tests/sample.pdf

6 packets, each with a distinct property address that exercises a different
shape of the address regex (no directional, single directional letter, full
directional word, multi-word street names, abbreviated vs spelled-out street
type, etc.). Every packet is preceded by a duplex red divider (two pages),
except the first one — that tests the "PDF starts without a separator" edge
case. The last packet has no trailing divider, testing the symmetric case.

Layout:
  1   packet A - front (123 Main St)
  2   packet A - body
  3   red divider (front of duplex sheet)
  4   red divider (back of duplex sheet)
  5   packet B - front (4582 N Oak Ridge Blvd)
  6   packet B - body
  7   packet B - body
  8   red divider
  9   red divider
  10  packet C - front (77 SW Cherry Lane)
  11  red divider
  12  red divider
  13  packet D - front (901 East Washington Avenue)
  14  packet D - body
  15  red divider
  16  red divider
  17  packet E - front (12 Riverbend Court)
  18  red divider
  19  red divider
  20  packet F - front (3344 Northwest Highland Park Drive)
  21  packet F - body
  22  packet F - body

Expected after splitting: 6 bundles with page counts 2, 3, 1, 2, 1, 3.
"""

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color
from pathlib import Path

OUT = Path(__file__).parent / "sample.pdf"

# Saturated red — well above the default 55% threshold.
RED = Color(0.92, 0.08, 0.08)

# (letter, property_address) — letterhead is the same on every packet so the
# multi-address case is also exercised on every front page.
PACKETS = [
    ("A", "123 Main St, Springfield, IL 62704"),
    ("B", "4582 N Oak Ridge Blvd, Naperville, IL 60540"),
    ("C", "77 SW Cherry Lane, Peoria, IL 61602"),
    ("D", "901 East Washington Avenue, Madison, WI 53703"),
    ("E", "12 Riverbend Court, Bloomington, IN 47401"),
    ("F", "3344 Northwest Highland Park Drive, Boulder, CO 80302"),
]

# Each packet's body length (page count includes the front page).
PAGE_COUNTS = {"A": 2, "B": 3, "C": 1, "D": 2, "E": 1, "F": 3}

LETTERHEAD_ADDR = "100 Title Plaza, Suite 200, Springfield, IL 62701"


def red_page(c):
    w, h = LETTER
    c.setFillColor(RED)
    c.rect(0, 0, w, h, stroke=0, fill=1)
    c.showPage()


def packet_front(c, packet_letter, property_addr, packet_no):
    w, h = LETTER

    # Letterhead block (top of page) - title company address.
    c.setFont("Times-Bold", 16)
    c.drawString(72, h - 72, "Stewart Title of Anywhere, LLC")
    c.setFont("Helvetica", 10)
    c.drawString(72, h - 90, LETTERHEAD_ADDR)
    c.drawString(72, h - 104, "Phone: (555) 123-4567")

    # Title.
    c.setFont("Times-Bold", 22)
    c.drawCentredString(w / 2, h - 180, f"Closing Disclosure  -  Packet {packet_letter}")

    # Property address block (the one we actually want).
    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, h - 240, "Property Address:")
    c.setFont("Helvetica", 12)
    c.drawString(72, h - 258, property_addr)

    # Filler so OCR has plenty to chew on if the embedded-text path is bypassed.
    c.setFont("Helvetica", 10)
    body = [
        "This document summarizes the actual costs for your loan and home purchase.",
        "Buyer:    Jane Q. Doe",
        "Seller:   John P. Smith",
        f"Loan ID:  LPTR-{1000 + packet_no}",
        "Closing Date:  May 1, 2026",
        "",
        "Please review the property address above and confirm it matches your records.",
    ]
    y = h - 300
    for line in body:
        c.drawString(72, y, line)
        y -= 14

    c.setFont("Helvetica-Oblique", 9)
    c.drawString(72, 72, f"Front page - packet {packet_letter}")
    c.showPage()


def body_page(c, packet_letter, page_label):
    w, h = LETTER
    c.setFont("Times-Bold", 16)
    c.drawString(72, h - 72, f"Packet {packet_letter} - {page_label}")
    c.setFont("Helvetica", 11)
    lines = [
        "This is a continuation page within the packet. It contains no address",
        "in the property-address format and should not be picked up by the",
        "first-match-wins regex when scanning the front page.",
        "",
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque",
        "habitant morbi tristique senectus et netus et malesuada fames ac",
        "turpis egestas. Suspendisse potenti.",
    ]
    y = h - 120
    for line in lines:
        c.drawString(72, y, line)
        y -= 16
    c.showPage()


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=LETTER)

    for i, (letter, addr) in enumerate(PACKETS):
        if i > 0:
            # Duplex red divider between packets.
            red_page(c)
            red_page(c)

        packet_front(c, letter, addr, packet_no=i + 1)
        for n in range(2, PAGE_COUNTS[letter] + 1):
            body_page(c, letter, f"page {n} of {PAGE_COUNTS[letter]}")

    c.save()
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
