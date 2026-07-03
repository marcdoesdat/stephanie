(function () {
  var STORAGE_KEY = 'sw_consent_v1';
  var ADS_ID = 'AW-18126348856';

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

  function loadAds() {
    if (window.__ads_loaded) return;
    window.__ads_loaded = true;
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + ADS_ID);
    loadScript('/js/gtag-init.js');
  }

  function applyConsent(state) {
    if (state === 'accepted') {
      loadAds();
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
