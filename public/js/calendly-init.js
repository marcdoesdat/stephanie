(function() {
  function calendlyInit() {
    if (!window.Calendly) return;
    var body = document.body;
    if (!body) return;
    var url = body.getAttribute('data-calendly-url');
    if (!url) return;

    // Popup (boutons CTA)
    var btns = document.querySelectorAll('[data-calendly]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function(e) {
        e.preventDefault();
        window.Calendly.initPopupWidget({ url: url });
      });
    }

    // Widget inline (section rendez-vous)
    var inline = document.querySelector('.calendly-inline-widget');
    if (inline) {
      window.Calendly.initInlineWidget({
        url: inline.getAttribute('data-url') || url,
        parentElement: inline,
      });
    }
  }

  function start() {
    if (window.Calendly) {
      calendlyInit();
    } else {
      var attempts = 0;
      var check = setInterval(function() {
        attempts++;
        if (window.Calendly) {
          clearInterval(check);
          calendlyInit();
        } else if (attempts > 40) {
          clearInterval(check);
        }
      }, 300);
    }
  }

  // Si le script est chargé après DOMContentLoaded (cas consent.js qui injecte le script
  // dynamiquement après acceptation), exécuter immédiatement.
  if (document.readyState !== 'loading') {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
