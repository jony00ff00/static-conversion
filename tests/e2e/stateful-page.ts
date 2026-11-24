/** A page whose state comes from checkboxes, radios, a select and scrolling (see capture-steps.test.ts). */
export const STATEFUL_PAGE = {
  html: `<header id="top">Header</header>
<main>
  <input type="checkbox" id="more" hidden>
  <label for="more" id="more-label">Show more</label>
  <div class="more" id="more-box">Hidden details</div>

  <div class="tabs">
    <input type="radio" name="tab" id="tab-a" checked>
    <input type="radio" name="tab" id="tab-b">
    <label for="tab-a">Tab A</label>
    <label for="tab-b" id="tab-b-label">Tab B</label>
    <div id="panel-a">Panel A</div>
    <div id="panel-b">Panel B</div>
  </div>

  <label>Wrapped <input type="checkbox" id="wrapped"></label>

  <select id="size"><option value="s">Small</option><option value="l">Large</option></select>
  <p id="size-out">s</p>

  <div style="height: 2400px"></div>
  <section id="late" class="reveal">Revealed on scroll</section>
  <div style="height: 600px"></div>
</main>`,
  css: `.more { display: none; }
#more:checked ~ .more { display: block; }
.tabs input { position: absolute; opacity: 0; pointer-events: none; }
#panel-b { display: none; }
#tab-b:checked ~ #panel-b { display: block; }
#tab-b:checked ~ #panel-a { display: none; }
.reveal { opacity: 0; transition: opacity 0.4s; }
.reveal.shown { opacity: 1; }
header.scrolled { background: rgb(10, 20, 30); color: #fff; }`,
  js: `document.getElementById('size').addEventListener('change', function (e) { document.getElementById('size-out').textContent = e.target.value; });
// Shown while in view, hidden again when scrolled away (the hard case).
new IntersectionObserver(function (es) { es.forEach(function (en) { en.target.classList.toggle('shown', en.isIntersecting); }); })
  .observe(document.getElementById('late'));
// A scroll handler throttled with requestAnimationFrame.
var ticking = false;
addEventListener('scroll', function () {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(function () { document.getElementById('top').classList.toggle('scrolled', scrollY > 200); ticking = false; });
});`,
};
