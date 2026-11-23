# Final acceptance

This is the only point where a person checks the output. Every milestone before it
passes on automated checks alone (see [`PLAN.md`](PLAN.md)).

## The acceptance pack

`npm run acceptance` (built in M10) creates a folder containing:

1. **Three end-to-end A4 projects** built from real-world-style sites, each as PDF, CMYK PDF/X
   and 300 dpi PNG.
2. **Margin test pages**, default and unusual margins, with mm rulers on every edge.
3. **Colour proof sheet:** brand swatches beside their CMYK soft proof, with the ΔE value
   next to each.
4. **Fold and cut test sheets:** landscape tri-fold and a step-and-repeat card sheet.
5. **Report (HTML):** results of every automated check, preflight results, font substitutions,
   anything captured as an image or replaced by a placeholder, and known limitations.

Until M10 exists, the M1 samples in [`samples/`](samples/) can be checked the same way.

## What to check

Automation can't prove these three things, so check them once:

### 1. Your printer
Print the margin test page at **100% / "Actual size"**, not "Fit to page", and measure from
each paper edge to the red line.

| Margin | Expected (default) | Measured | Expected (odd page) | Measured | Within ± 1 mm? |
|---|---|---|---|---|---|
| Top | 20 | | 10 | | ☐ |
| Right | 15 | | 25 | | ☐ |
| Bottom | 20 | | 30 | | ☐ |
| Left | 15 | | 12 | | ☐ |

If every margin is off by the same amount in one direction, the printer is shifting the
page, which is normal for office printers.

### 2. Colour on paper
Print the colour proof sheet, or get a proof from your print shop, and compare it with your
brand references. ☐

### 3. Judgement
For each of the three sample projects:

- [ ] It looks like something you'd send to print.
- [ ] No content you need is missing or cut off.
- [ ] Fonts are acceptable. The report lists any substitutions; matching the site exactly
      needs the real fonts installed on the server.
- [ ] Text is readable. The report gives the smallest size on paper.

If anything fails, it is turned into an automated test before it's fixed.

Signed off by: ____________  Date: ________
