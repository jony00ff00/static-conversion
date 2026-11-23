/**
 * Hand-labelled reference trees: what a designer would expect as components
 * at each level of detail. Levels are cumulative (level 2 = level 1 + these).
 * Each entry is a CSS selector resolved against the frozen page; only visible
 * elements count.
 */
export const LABELS: Record<string, string[][]> = {
  '01-static': [
    ['header', 'section.hero', 'section.features', 'blockquote', 'footer'],
    ['nav', '.hero h1', '.hero img', '.hero p', 'article.card'],
    ['.card h3', '.card p'],
  ],
  '02-tailwind': [
    ['nav', 'body > section:nth-of-type(1)', 'body > section:nth-of-type(2)', 'footer'],
    ['body > section:nth-of-type(1) h1', 'body > section:nth-of-type(1) p', 'body > section:nth-of-type(2) > div'],
    ['body > section:nth-of-type(2) h2', 'body > section:nth-of-type(2) p', 'body > section:nth-of-type(2) ul'],
  ],
  '03-bootstrap': [['nav.navbar', 'h1', '.card', '.alert'], ['.navbar-nav', '.card-title', '.card-text'], []],
  '04-react-spa': [['header.app-header', 'main.menu', 'p.note'], ['header h1', 'header p', '.dish'], ['.dish > div > div']],
  '05-canvas-chart': [['h1', 'figure'], ['figure img', 'figcaption'], []],
  '06-svg-infographic': [['h1', '.stat', 'body > svg'], ['.stat svg', '.stat p'], []],
  '07-webfonts': [['h1', 'p'], [], []],
  '08-long-article': [['article'], ['article > h1', 'article > p', 'article > h2', 'article > table'], []],
  '09-div-soup': [
    ['.a', '.e', '.c > div:not(.d) > div', '.h'],
    ['.a > div', '.f', '.g', '.h > div'],
    [],
  ],
  '10-interactive': [
    ['h1', 'p.fade-in', '.tabs', 'h2', '.accordion', 'details', '.carousel'],
    ['[role=tablist]', '[role=tabpanel]', '.accordion button', '.accordion .panel', 'details > summary', 'details > p', '.slide'],
    ['[role=tab]'],
  ],
  '11-print-media-darkmode': [['h1', 'main > p:not(.only-print)', 'table'], [], []],
  '12-cross-origin-iframe': [['h1', 'body > p', '[data-ve-frozen=placeholder]'], [], []],
};
