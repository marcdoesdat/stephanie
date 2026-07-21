(function () {
  var STORAGE_KEY = 'sw_consent_v1';
  var GTAG_ID = 'AW-18126348856';

  var banner = document.getElementById('consent-banner');
  if (!banner) return;

  var acceptBtn = document.getElementById('consent-accept');
  var refuseBtn = document.getElementById('consent-refuse');

  function loadScript(src) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
    return s;
  }

  function loadGtag() {
    if (window.__gtag_loaded) return;
    window.__gtag_loaded = true;
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + GTAG_ID);
    loadScript('/js/gtag-init.js');
  }

  // Consent Mode v2 : signale le choix à GTM/gtag. Les défauts « denied »
  // sont posés avant GTM dans le <head> (MainLayout) ; ici on ne fait que
  // les mettre à jour quand le visiteur clique Accepter ou Refuser.
  function updateConsentMode(state) {
    window.dataLayer = window.dataLayer || [];
    var gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    var v = state === 'accepted' ? 'granted' : 'denied';
    gtag('consent', 'update', {
      ad_storage: v,
      ad_user_data: v,
      ad_personalization: v,
      analytics_storage: v
    });
    gtag('set', 'ads_data_redaction', state !== 'accepted');
  }

  function applyConsent(state) {
    updateConsentMode(state);
    if (state === 'accepted') {
      loadGtag();
    }
  }

  function showBanner() {
    banner.hidden = false;
  }

  function hideBanner() {
    banner.hidden = true;
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: state, ts: Date.now() }));
    } catch (e) {}
  }

  function read() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && data.state ? data.state : null;
    } catch (e) {
      return null;
    }
  }

  if (acceptBtn) {
    acceptBtn.addEventListener('click', function () {
      save('accepted');
      hideBanner();
      applyConsent('accepted');
    });
  }

  if (refuseBtn) {
    refuseBtn.addEventListener('click', function () {
      save('refused');
      hideBanner();
      // Cas « Gérer mes cookies » après un accord antérieur : les tags déjà
      // chargés doivent repasser en denied immédiatement.
      applyConsent('refused');
    });
  }

  // Lien permanent "Gérer mes cookies" (présent dans le footer)
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('[data-consent-manage]')) {
      e.preventDefault();
      showBanner();
    }
  });

  var existing = read();
  if (existing === 'accepted') {
    applyConsent('accepted');
  } else if (existing !== 'refused') {
    showBanner();
  }
})();
