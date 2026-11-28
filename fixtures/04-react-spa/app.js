/* Built entirely by JS: nothing meaningful exists in the HTML until React runs. */
(function () {
  var h = React.createElement;
  var dishes = [
    { name: 'Margherita', desc: 'Tomato, mozzarella, basil', price: '£9.50' },
    { name: 'Diavola', desc: 'Spicy salami, chilli', price: '£11.00' },
    { name: 'Funghi', desc: 'Mushrooms, garlic, thyme', price: '£10.50' },
    { name: 'Quattro Formaggi', desc: 'Four cheeses', price: '£12.00' },
  ];
  function Dish(p) {
    return h('div', { className: 'dish' },
      h('div', null, h('strong', null, p.name), h('div', null, p.desc)),
      h('span', { className: 'price' }, p.price));
  }
  function App() {
    var printed = new Date().toISOString().slice(0, 10);
    return h('div', null,
      h('header', { className: 'app-header' }, h('h1', null, 'Luigi’s Pizzeria'), h('p', null, 'Menu')),
      h('main', { className: 'menu' }, dishes.map(function (d) { return h(Dish, Object.assign({ key: d.name }, d)); })),
      h('p', { className: 'note' }, 'Menu generated ' + printed + ' · ref ' + Math.random().toString(36).slice(2, 8)));
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
