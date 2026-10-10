/*
 * Moteur de traduction FR → EN du site (aucune dépendance).
 *
 * Partagé entre le navigateur (public/js/i18n.js) et l'outil d'extraction
 * (scripts/i18n-extraire.mjs, qui l'exécute sur un DOM linkedom) : les clés du
 * dictionnaire sont donc calculées par le MÊME code des deux côtés.
 *
 * Principe : une « unité » est le plus haut élément qui ne contient que du texte et des
 * balises en ligne (<a>, <strong>, <span>…). Sa clé est son contenu où chaque balise en ligne
 * est remplacée par un numéro d'ordre : « Voyez <1>nos taux</1> ici ». La traduction garde
 * la même numérotation, ce qui permet de réordonner les mots sans jamais recréer les
 * éléments (les écouteurs et les références des scripts de la page survivent).
 */
(function (g) {
  var INLINE = { A: 1, STRONG: 1, EM: 1, B: 1, I: 1, SPAN: 1, BR: 1, SUP: 1, SUB: 1, SMALL: 1, ABBR: 1, MARK: 1, U: 1, CODE: 1, TIME: 1, WBR: 1, S: 1, Q: 1, CITE: 1, LABEL: 0 };
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, TEMPLATE: 1, TEXTAREA: 1, IFRAME: 1, CANVAS: 1, HEAD: 1, OPTGROUP: 0 };
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  var LETTRE = /[A-Za-zÀ-ÿ]/;

  function collapse(s) { return s.replace(/\s+/g, ' ').trim(); }
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function unesc(s) { return s.replace(/&lt;/g, '<').replace(/&amp;/g, '&'); }

  function tag(el) { return (el.tagName || '').toUpperCase(); }

  function ignore(el) {
    if (el.nodeType !== 1) return false;
    if (SKIP_TAGS[tag(el)]) return true;
    if (el.hasAttribute('data-no-i18n') || el.getAttribute('translate') === 'no') return true;
    return false;
  }

  // Un élément est « en ligne seulement » si tout ce qu'il contient l'est.
  function inlineOnly(el) {
    var c = el.childNodes;
    for (var i = 0; i < c.length; i++) {
      var n = c[i];
      if (n.nodeType === 3 || n.nodeType === 8) continue;
      if (n.nodeType !== 1) return false;
      if (!INLINE[tag(n)] || ignore(n) || !inlineOnly(n)) return false;
    }
    return true;
  }

  // Plusieurs éléments côte à côte, sans aucun texte entre eux (<span>🏡</span> <span>…</span>) :
  // c'est une mise en page, pas une phrase. Chaque morceau se traduit seul.
  function conteneur(el) {
    var n = 0, c = el.childNodes;
    for (var i = 0; i < c.length; i++) {
      if (c[i].nodeType === 3 && /\S/.test(c[i].data)) return false;
      if (c[i].nodeType === 1) n++;
    }
    return n >= 2;
  }

  function hasText(el) {
    return LETTRE.test(el.textContent || '');
  }

  // L'unique enfant élément d'`el` quand il n'y a rien d'autre que des espaces autour.
  function enfantUnique(el) {
    var seul = null, c = el.childNodes;
    for (var i = 0; i < c.length; i++) {
      var n = c[i];
      if (n.nodeType === 3) { if (/\S/.test(n.data)) return null; }
      else if (n.nodeType === 1) { if (seul) return null; seul = n; }
    }
    return seul && seul.firstChild && tag(seul) !== 'BR' ? seul : null;
  }

  // Sérialise en gabarit « brut » (espaces conservés) ; remplit `els` dans l'ordre préfixe.
  function gabarit(el, els) {
    var out = '';
    var c = el.childNodes;
    for (var i = 0; i < c.length; i++) {
      var n = c[i];
      if (n.nodeType === 3) { out += esc(n.data); continue; }
      if (n.nodeType !== 1) continue;
      els.push(n);
      var k = els.length;
      if (!n.firstChild) out += '<' + k + '/>';
      else out += '<' + k + '>' + gabarit(n, els) + '</' + k + '>';
    }
    return out;
  }

  function cle(brut) { return collapse(brut); }

  /** Parcourt le DOM et rend les unités traduisibles. */
  function collecter(racine) {
    var res = [];
    (function visiter(el) {
      if (ignore(el)) return;
      if (el !== racine || el.nodeType === 1) {
        if (el.nodeType === 1 && inlineOnly(el) && hasText(el) && !conteneur(el)) {
          // Une enveloppe qui ne contient qu'un seul élément (<li><a>Taux</a></li>) : on
          // descend jusqu'au texte, la clé reste « Taux » et vaut pour tout autre emploi.
          var cible = el;
          while (enfantUnique(cible)) cible = enfantUnique(cible);
          var els = [];
          var brut = gabarit(cible, els);
          res.push({ type: 'unite', el: cible, brut: brut, cle: cle(brut), els: els });
          attrs(el, res, true);
          return;
        }
      }
      attrs(el, res, false);
      var c = el.childNodes;
      for (var i = 0; i < c.length; i++) {
        var n = c[i];
        if (n.nodeType === 3) {
          if (LETTRE.test(n.data)) res.push({ type: 'texte', node: n, brut: n.data, cle: collapse(n.data) });
          else if (/\d/.test(n.data)) res.push({ type: 'nombre', node: n, brut: n.data, cle: collapse(n.data) });
        } else if (n.nodeType === 1) visiter(n);
      }
    })(racine);
    return res;
  }

  // Attributs traduisibles de l'élément ; `profond` = aussi ceux de ses enfants en ligne.
  function attrs(el, res, profond) {
    function un(e) {
      for (var i = 0; i < ATTRS.length; i++) {
        var v = e.getAttribute && e.getAttribute(ATTRS[i]);
        if (v && LETTRE.test(v)) res.push({ type: 'attr', el: e, attr: ATTRS[i], brut: v, cle: collapse(v) });
      }
      if (tag(e) === 'INPUT') {
        var t = (e.getAttribute('type') || '').toLowerCase();
        var val = e.getAttribute('value');
        if ((t === 'submit' || t === 'button') && val && LETTRE.test(val)) res.push({ type: 'attr', el: e, attr: 'value', brut: val, cle: collapse(val) });
      }
    }
    un(el);
    if (profond) {
      var tous = el.querySelectorAll ? el.querySelectorAll('*') : [];
      for (var i = 0; i < tous.length; i++) if (!ignore(tous[i])) un(tous[i]);
    }
  }

  /** Les textes de l'en-tête : titre et métadonnées. */
  function entete(doc) {
    var res = [];
    var t = doc.querySelector('title');
    if (t && LETTRE.test(t.textContent)) res.push({ type: 'titre', el: t, brut: t.textContent, cle: collapse(t.textContent) });
    var metas = doc.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="twitter:description"]');
    for (var i = 0; i < metas.length; i++) {
      var v = metas[i].getAttribute('content');
      if (v && LETTRE.test(v)) res.push({ type: 'attr', el: metas[i], attr: 'content', brut: v, cle: collapse(v) });
    }
    return res;
  }

  /** Découpe un gabarit en jetons ; null si les balises ne sont pas bien appariées. */
  function jetons(tpl, n) {
    var re = /<(\/?)(\d+)(\/?)>/g, m, last = 0, out = [], pile = [], vus = {};
    while ((m = re.exec(tpl))) {
      if (m.index > last) out.push({ t: 'txt', v: unesc(tpl.slice(last, m.index)) });
      last = re.lastIndex;
      var num = +m[2];
      if (num < 1 || num > n) return null;
      if (m[1]) { if (pile.pop() !== num) return null; out.push({ t: 'fin', n: num }); }
      else {
        if (vus[num]) return null;
        vus[num] = 1;
        if (m[3]) out.push({ t: 'vide', n: num });
        else { pile.push(num); out.push({ t: 'deb', n: num }); }
      }
    }
    if (last < tpl.length) out.push({ t: 'txt', v: unesc(tpl.slice(last)) });
    if (pile.length) return null;
    for (var k = 1; k <= n; k++) if (!vus[k]) return null;
    return out;
  }

  /** Vérifie qu'un gabarit anglais est utilisable pour une unité de `n` balises. */
  function valide(tpl, n) { return jetons(tpl, n) !== null; }

  /** Remplace le contenu de `el` par le gabarit, en réutilisant les éléments d'origine. */
  function appliquer(el, els, tpl) {
    var toks = jetons(tpl, els.length);
    if (!toks) return false;
    var i, doc = el.ownerDocument;
    for (i = 0; i < els.length; i++) while (els[i].firstChild) els[i].removeChild(els[i].firstChild);
    while (el.firstChild) el.removeChild(el.firstChild);
    var pile = [el];
    for (i = 0; i < toks.length; i++) {
      var t = toks[i], cur = pile[pile.length - 1];
      if (t.t === 'txt') cur.appendChild(doc.createTextNode(t.v));
      else if (t.t === 'vide') cur.appendChild(els[t.n - 1]);
      else if (t.t === 'deb') { cur.appendChild(els[t.n - 1]); pile.push(els[t.n - 1]); }
      else pile.pop();
    }
    return true;
  }

  /** Conserve les espaces de tête et de queue de l'original autour de la traduction. */
  function cadrer(brut, trad) {
    var a = /^\s*/.exec(brut)[0], b = /\s*$/.exec(brut)[0];
    return a + trad + b;
  }

  var frags = []; // [français, anglais] — remplacements de morceaux fixes dans un long texte
  var regles = []; // [RegExp, remplacement] — voir public/js/i18n-regles.js

  // ---------------------------------------------------------------------------------------
  // Traducteur : applique le dictionnaire à un morceau de DOM. Utilisé tel quel par le serveur
  // (src/services/traductionPage.ts, qui produit les pages /en/) et par le navigateur
  // (public/js/i18n.js, pour le texte que les scripts des calculateurs écrivent après coup).
  // ---------------------------------------------------------------------------------------
  var MOIS = {
    janvier: 'January', 'février': 'February', mars: 'March', avril: 'April', mai: 'May', juin: 'June',
    juillet: 'July', 'août': 'August', septembre: 'September', octobre: 'October', novembre: 'November',
    'décembre': 'December',
  };
  var GROUPE = '[\\u00a0\\u202f ]';

  function milliers(s) { return s.replace(/[   ]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u0001'); }

  // Le français écrit « 1 234,50 $ », l'anglais « $1,234.50 ».
  function formaterNombres(s) {
    return s
      .replace(new RegExp('(\\d{1,3}(?:' + GROUPE + '\\d{3})+|\\d+)(?:,(\\d+))?' + GROUPE + '?\\$', 'g'), function (_, ent, dec) {
        return '$' + milliers(ent) + (dec ? '.' + dec : '');
      })
      .replace(/(\d+),(\d+)[   ]?%/g, '$1.$2%')
      .replace(/(\d+)[   ]%/g, '$1%')
      .replace(/\d{1,3}(?:[  ]\d{3})+/g, function (m) { return milliers(m); })
      // 5,25 → 5.25 ; mais jamais « 4,000 » : une virgule suivie de trois chiffres est déjà un
      // séparateur de milliers anglais, que ce texte ait été traduit avant d'arriver ici
      .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
      // les séparateurs de milliers posés plus haut étaient protégés de la règle précédente
      .replace(/\u0001/g, ',');
  }

  // Phrase construite par un script, avec des chiffres au milieu : formats, dates, puis règles.
  function dynamique(s) {
    var t = formaterNombres(s);
    t = t.replace(/\b(\d{1,2})(?:er)? (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) (\d{4})\b/g,
      function (_, j, m, a) { return MOIS[m] + ' ' + j + ', ' + a; });
    t = t.replace(/\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) (\d{4})\b/g,
      function (_, m, a) { return MOIS[m] + ' ' + a; });
    for (var i = 0; i < regles.length; i++) {
      var r = regles[i];
      if (r[0].test(t)) { r[0].lastIndex = 0; return t.replace(r[0], r[1]); }
    }
    // Aucune phrase complète reconnue : on remplace les morceaux fixes (blocs de texte longs
    // dont les chiffres changent, comme le détail du calcul de pénalité).
    for (var j = 0; j < frags.length; j++) if (t.indexOf(frags[j][0]) !== -1) t = t.split(frags[j][0]).join(frags[j][1]);
    return t;
  }

  /**
   * @param dico  le dictionnaire FR → EN
   * @param h     { registre(entrée) : pour pouvoir défaire, noter(clé) : texte sans traduction }
   */
  function traducteur(dico, h) {
    h = h || {};
    var a = function (k) { return Object.prototype.hasOwnProperty.call(dico, k); };

    function texteTraduit(cle) {
      if (a(cle)) return dico[cle];
      // « ⚠️ Message » ou « ✅ Message » : le symbole est ajouté par le script, pas traduit.
      var m = /^([^A-Za-zÀ-ÿ0-9<]+)(.+)$/.exec(cle);
      return m && a(m[2]) ? m[1] + dico[m[2]] : undefined;
    }

    function noter(cle) { if (h.noter) h.noter(cle); }
    function enregistrer(e) { if (h.registre) h.registre(e); }

    function traiterItem(it) {
      if (it.type === 'unite') {
        if (it.el.__swU === it.brut) return; // déjà traduite
        var tpl = texteTraduit(it.cle);
        if (tpl !== undefined) {
          if (appliquer(it.el, it.els, cadrer(it.brut, tpl))) {
            it.el.__swU = gabarit(it.el, []);
            enregistrer({ t: 'unite', el: it.el, els: it.els, fr: it.brut, en: it.el.__swU });
          }
          return;
        }
        // Clé inconnue (souvent : un chiffre dynamique au milieu) → on traduit par morceaux.
        degrader(it.el);
        return;
      }
      if (it.type === 'texte' || it.type === 'nombre') {
        var n = it.node;
        if (n.__swEn === n.data) return;
        var tp = it.type === 'texte' ? texteTraduit(it.cle) : undefined;
        var res;
        if (tp !== undefined) res = cadrer(it.brut, tp);
        else {
          res = dynamique(it.brut);
          if (it.type === 'texte' && res === it.brut && /[A-Za-zÀ-ÿ]{3,}/.test(it.brut)) noter(it.cle);
        }
        if (res !== it.brut) {
          n.data = res; n.__swEn = res;
          enregistrer({ t: 'texte', node: n, fr: it.brut, en: res });
        }
        return;
      }
      if (it.type === 'attr' || it.type === 'titre') {
        var el = it.el;
        var tr = texteTraduit(it.cle);
        if (tr === undefined) { tr = dynamique(it.brut); if (tr === it.brut) { noter(it.cle); return; } }
        if (it.type === 'titre') {
          if (el.textContent === tr) return;
          el.textContent = tr;
          enregistrer({ t: 'titre', el: el, fr: it.brut, en: tr });
        } else {
          if (el.getAttribute(it.attr) === tr) return;
          el.setAttribute(it.attr, tr);
          enregistrer({ t: 'attr', el: el, attr: it.attr, fr: it.brut, en: tr });
        }
      }
    }

    // Une unité dont la clé est absente : texte direct traduit seul, éléments enfants un à un.
    function degrader(el) {
      var c = el.childNodes;
      for (var i = 0; i < c.length; i++) {
        var n = c[i];
        if (n.nodeType === 3) {
          if (/[A-Za-zÀ-ÿ]/.test(n.data)) traiterItem({ type: 'texte', node: n, brut: n.data, cle: collapse(n.data) });
          else if (/\d/.test(n.data)) traiterItem({ type: 'nombre', node: n, brut: n.data, cle: collapse(n.data) });
        } else if (n.nodeType === 1 && !ignore(n)) {
          var items = collecter(n);
          for (var j = 0; j < items.length; j++) {
            if (items[j].type === 'unite' && items[j].el === el) continue;
            traiterItem(items[j]);
          }
        }
      }
    }

    function traiter(noeud) {
      if (noeud.nodeType === 3) noeud = noeud.parentNode;
      if (!noeud || noeud.nodeType !== 1 || ignore(noeud)) return;
      if (noeud.closest && noeud.closest('[data-no-i18n]')) return;
      var items = collecter(noeud);
      for (var i = 0; i < items.length; i++) traiterItem(items[i]);
    }

    return {
      traiter: traiter,
      entete: function (doc) { var e = entete(doc); for (var i = 0; i < e.length; i++) traiterItem(e[i]); },
      traduit: function (cle) { return texteTraduit(cle); },
    };
  }

  g.swI18nCore = {
    frags: frags, frag: function (fr, en) { frags.push([fr, en]); },
    regles: regles, regle: function (re, rempl) { regles.push([re, rempl]); },
    traducteur: traducteur, dynamique: dynamique, formaterNombres: formaterNombres,
    collapse: collapse, collecter: collecter, entete: entete, appliquer: appliquer,
    valide: valide, cadrer: cadrer, serialiser: function (el) { return gabarit(el, []); }, cle: cle, ignore: ignore,
  };
})(typeof window !== 'undefined' ? window : globalThis);
