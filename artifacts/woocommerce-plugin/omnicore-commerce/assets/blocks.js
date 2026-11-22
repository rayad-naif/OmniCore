/* OmniCore checkout for the WooCommerce block Checkout (no build step: uses WordPress globals). */
(function () {
  var wc = window.wc || {};
  if (
    !wc.wcBlocksRegistry ||
    !wc.wcSettings ||
    !window.wp ||
    !window.wp.element
  )
    return;
  var el = window.wp.element.createElement;
  var decode = window.wp.htmlEntities
    ? window.wp.htmlEntities.decodeEntities
    : function (s) {
        return s;
      };
  var data = wc.wcSettings.getSetting('omnicore_data', {});
  var label = decode(data.title || 'Pay online');
  var Content = function () {
    return el('div', null, decode(data.description || ''));
  };
  wc.wcBlocksRegistry.registerPaymentMethod({
    name: 'omnicore',
    label: el('span', null, label),
    ariaLabel: label,
    content: el(Content, null),
    edit: el(Content, null),
    canMakePayment: function () {
      return true;
    },
    supports: { features: data.supports || ['products'] },
  });
})();
