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

  var closeBtn = document.getElementById('consent-close');
  var closeFirst = document.getElementById('consent-close-first');
  var closeManage = document.getElementById('consent-close-manage');
  var statusAccepted = document.getElementById('consent-status-accepted');
  var statusRefused = document.getElementById('consent-status-refused');
  // Le lien « Gérer mes cookies » qui a rouvert la bannière : le focus y revient à la fermeture.
  var opener = null;

  // `manage` : rouverte par le visiteur. La bannière rappelle alors le choix en vigueur, peut se
  // fermer sans rien changer, et prend le focus. À la première visite, elle ne le prend pas :
  // elle n'interrompt pas la lecture, elle est seulement la première chose atteinte au clavier.
  function showBanner(manage) {
    if (!banner) return;
    var state = read();
    if (statusAccepted) statusAccepted.hidden = state !== 'accepted';
    if (statusRefused) statusRefused.hidden = state !== 'refused';
    // La croix change de sens selon qu'un choix existe déjà — son libellé aussi.
    if (closeFirst) closeFirst.hidden = !!state;
    if (closeManage) closeManage.hidden = !state;
    banner.hidden = false;
    // Sur téléphone, la barre « Prendre rendez-vous » cède la place (voir ConsentBanner.astro).
    document.body.classList.add('consent-open');
    if (manage) banner.focus();
  }

  function hideBanner() {
    if (!banner) return;
    banner.hidden = true;
    document.body.classList.remove('consent-open');
    if (opener && opener.focus) opener.focus();
    opener = null;
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
    var lien = t && t.closest ? t.closest('[data-consent-manage]') : null;
    if (lien) {
      e.preventDefault();
      opener = lien;
      showBanner(true);
    }
  });

  // La croix : avec un choix enregistré, elle ferme sans rien changer. Sans choix, elle vaut
  // un refus (son libellé dit « Fermer sans accepter ») — jamais un accord, et pas un
  // non-choix qui ferait revenir la bannière à chaque page.
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      if (read()) hideBanner();
      else if (refuseBtn) refuseBtn.click();
    });
  }
  // Échap ne ferme que si un choix existe déjà : à la première visite, la touche sert à autre
  // chose sur la page (infobulles) et ne doit pas valoir un refus par accident.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && banner && !banner.hidden && read()) hideBanner();
  });

  var existing = read();
  if (existing === 'accepted') {
    applyConsent('accepted');
  } else if (existing !== 'refused') {
    showBanner();
  }
})();
