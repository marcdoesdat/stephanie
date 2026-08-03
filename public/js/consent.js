(function () {
  var STORAGE_KEY = 'sw_consent_v1';
  var GTAG_ID = 'AW-18126348856';
  var GTM_ID = 'GTM-P9NJL58S';

  var banner = document.getElementById('consent-banner');
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

  // GTM n'est plus dans le <head> : Consent Mode « denied » laisse quand même
  // le container charger ses tags. On l'injecte donc seulement après un
  // consentement explicite, après le consent update pour que le container
  // démarre déjà en « granted ».
  function loadGtm() {
    if (window.__gtm_loaded) return;
    window.__gtm_loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    loadScript('https://www.googletagmanager.com/gtm.js?id=' + GTM_ID);
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
      loadGtm();
      loadGtag();
    }
  }

  function showBanner() {
    if (banner) banner.hidden = false;
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
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
