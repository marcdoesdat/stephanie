/*
 * Bascule FR / EN du site, côté navigateur.
 *
 * L'anglais vit à des adresses à lui — /en/, /en/outils/… — produites par le serveur
 * (src/services/traductionPage.ts) : le HTML y est déjà en anglais, donc indexable. Ce script
 * ne traduit plus la page ; il fait trois choses :
 *
 *  1. la bascule : un clic sur FR / EN mène à la même page dans l'autre langue, et mémorise le
 *     choix (localStorage, clé sw_lang — une préférence d'affichage, pas un témoin de suivi) ;
 *  2. sur une page /en/, le texte que les scripts des calculateurs écrivent après coup
 *     (résultats, messages d'erreur) est traduit au passage par un MutationObserver, avec le
 *     même moteur que le serveur (public/js/i18n-core.js) ;
 *  3. sur une page /en/, les liens internes que les scripts posent (« tableau d'amortissement »)
 *     restent dans /en/.
 *
 * Le redirigement d'un visiteur « EN » arrivé sur une page française se fait dans l'en-tête
 * (MainLayout.astro), avant l'affichage.
 *
 * Les textes introuvables restent en français — jamais de texte inventé — et sont listés dans
 * window.swI18n.manquantes() : voir scripts/i18n-extraire.mjs.
 */
(function () {
  var CLE = 'sw_lang';
  var core = window.swI18nCore;
  if (!core) return;

  var chemin = location.pathname;
  var natif = chemin === '/en' || chemin.indexOf('/en/') === 0;

  function versEn(p) { return '/en' + (p === '/' ? '/' : p); }
  function versFr(p) { return p.replace(/^\/en(?=\/|$)/, '') || '/'; }

  // ---------------------------------------------------------------------------------------
  // Bascule
  // ---------------------------------------------------------------------------------------
  function marquerBoutons() {
    var bs = document.querySelectorAll('.lang-switch [data-lang]');
    for (var i = 0; i < bs.length; i++) {
      bs[i].setAttribute('aria-pressed', bs[i].getAttribute('data-lang') === (natif ? 'en' : 'fr') ? 'true' : 'false');
    }
  }

  // Les pages sans barre de navigation reçoivent la bascule en haut à droite.
  function ajouterBascule() {
    if (document.querySelector('.lang-switch')) return;
    var d = document.createElement('div');
    d.className = 'lang-switch lang-switch--flottant';
    d.setAttribute('data-no-i18n', '');
    d.setAttribute('role', 'group');
    d.setAttribute('aria-label', 'Langue / Language');
    d.innerHTML = '<button type="button" data-lang="fr" lang="fr" aria-label="Français">FR</button>' +
      '<span aria-hidden="true">/</span>' +
      '<button type="button" data-lang="en" lang="en" aria-label="English">EN</button>';
    document.body.appendChild(d);
  }

  function changer(l) {
    if ((l === 'en') === natif) return;
    try { localStorage.setItem(CLE, l); } catch (e) {}
    var cible = l === 'en' ? versEn(chemin) : versFr(chemin);
    location.assign(cible + location.search + location.hash);
  }

  // ---------------------------------------------------------------------------------------
  // Contenu que la page réécrit après coup (pages /en/ seulement)
  // ---------------------------------------------------------------------------------------
  var manquantes = {};
  var traducteur = null;
  var observateur = null;
  var enFile = null;
  var occupe = false;
  var valeursEn = null;

  function dejaEnAnglais(dico, cle) {
    if (!valeursEn) {
      valeursEn = {};
      for (var k in dico) if (Object.prototype.hasOwnProperty.call(dico, k)) valeursEn[core.collapse(dico[k].replace(/<\/?\d+\/?>/g, ''))] = 1;
    }
    return !!valeursEn[cle];
  }

  function planifier(cible) {
    if (!enFile) {
      enFile = [];
      // setTimeout et non requestAnimationFrame : ce dernier est suspendu dans un onglet en
      // arrière-plan, et un résultat de calcul resterait en français jusqu'au retour.
      setTimeout(function () {
        var f = enFile; enFile = null;
        occupe = true;
        try {
          for (var i = 0; i < f.length; i++) if (f[i] && document.contains(f[i])) traducteur.traiter(f[i]);
        } finally { occupe = false; observateur.takeRecords(); }
      });
    }
    enFile.push(cible);
  }

  function observer(dico) {
    var notable = false; // la première passe voit surtout du texte déjà anglais : rien à signaler
    traducteur = core.traducteur(dico, {
      noter: function (cle) { if (notable && cle && cle.length < 300 && !dejaEnAnglais(dico, cle)) manquantes[cle] = 1; },
    });
    // Les calculateurs écrivent leurs résultats par défaut dès le chargement, souvent avant que
    // le dictionnaire ne soit arrivé : une passe rattrape ce qui est déjà à l'écran en français.
    // Elle est sans danger sur le texte déjà anglais — une clé n'y correspond à rien.
    traducteur.traiter(document.body);
    notable = true;
    if (!window.MutationObserver) return;
    observateur = new MutationObserver(function (muts) {
      if (occupe) return;
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        planifier(m.type === 'characterData' ? m.target.parentNode : m.target);
      }
    });
    // Le HTML est déjà en anglais : on n'observe que ce que les scripts changeront.
    observateur.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title', 'alt'],
    });
  }

  function chargerDictionnaire() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/js/i18n-en.json');
    xhr.onload = function () {
      try { observer(JSON.parse(xhr.responseText)); } catch (e) {}
    };
    xhr.send();
  }

  // Un lien interne posé par un script (« /amortissement?… ») reste dans /en/.
  var EXCLUS = /^\/(api|js|images|_astro|en)(\/|$)|\.[a-z0-9]{2,5}$/i;
  function corrigerLiens() {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a[href^="/"]');
      if (!a || a.getAttribute('href').indexOf('//') === 0) return;
      var u = new URL(a.getAttribute('href'), location.origin);
      if (!EXCLUS.test(u.pathname)) a.setAttribute('href', versEn(u.pathname) + u.search + u.hash);
    }, true);
  }

  function demarrer() {
    ajouterBascule();
    marquerBoutons();
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.lang-switch [data-lang]');
      if (b) changer(b.getAttribute('data-lang'));
    });
    if (natif) { corrigerLiens(); chargerDictionnaire(); }
  }

  window.swI18n = {
    langue: function () { return natif ? 'en' : 'fr'; },
    changer: changer,
    manquantes: function () { return Object.keys(manquantes); },
    // Texte encore en français à l'écran (heuristique) — pour vérifier une page à la main.
    reste: function () {
      var FR = /[àâçéèêëîïôûùü]|\b(le|la|les|des|votre|vos|pour|avec|vous|mois|prêt|taux|une|est|dans|sur|pas|ans)\b/i;
      var EN = /\b(the|your|you|and|of|to|is|for|with|in)\b/i;
      var out = {}, w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        var n = w.currentNode, p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || p.closest('[data-no-i18n]')) continue;
        var t = core.collapse(n.data);
        if (t && FR.test(t) && !EN.test(t)) out[t.slice(0, 170)] = 1;
      }
      return Object.keys(out);
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
})();
