/*
 * Phrases que les scripts du site construisent avec des chiffres au milieu (« Vous épargnez
 * 291 $ net… ») : leur clé change à chaque calcul, elles ne peuvent donc pas figurer au
 * dictionnaire. Une règle par forme.
 *
 * Le texte arrive déjà passé par formaterNombres (i18n.js) : « 1 234 $ » est devenu « $1,234 »,
 * « 3,45 % » « 3.45% ». Une règle s'écrit donc avec ces formes-là.
 *
 *   {m} un montant   {n} un nombre   {h} un horizon (« sur ≈ 5 ans restants »)   {t} un texte
 *
 * Dans la phrase anglaise, {1}, {2}… renvoient aux captures dans l'ordre.
 * Les phrases fixes (sans chiffre) vont au dictionnaire, pas ici.
 */
(function () {
  var core = (typeof window !== 'undefined' ? window : globalThis).swI18nCore;
  if (!core) return;

  var MONTANT = '([+\\u2212-]?\\$[\\d,]+(?:\\.\\d+)?)';
  var NOMBRE = '([\\d.,]+)';
  var HORIZON = '(sur ≈ [\\d.,]+ ans? restants?)';

  function annees(n) { return n + (Number(n) === 1 ? ' year' : ' years'); }

  // « sur ≈ 5 ans restants » → « over ≈ 5 years remaining »
  function horizon(s) {
    var m = /sur ≈ ([\d.,]+) ans? restants?/.exec(s);
    return m ? 'over ≈ ' + annees(m[1]) + ' remaining' : s;
  }

  function P(fr, en) {
    var genres = [];
    var motif = fr
      .replace(/[.*+?^$()[\]|\\]/g, '\\$&')
      .replace(/'/g, "['’]")
      .replace(/\{(m|n|h|t)\}/g, function (_, g) {
        genres.push(g);
        return g === 'm' ? MONTANT : g === 'n' ? NOMBRE : g === 'h' ? HORIZON : '(.+?)';
      });
    core.regle(new RegExp('^' + motif + '$'), function () {
      var a = arguments;
      return en.replace(/\{(\d)\}/g, function (_, i) {
        var v = a[+i];
        return genres[i - 1] === 'h' ? horizon(v) : v;
      });
    });
  }

  function R(re, fn) { core.regle(re, fn); }

  // --- Durées : « 3 ans », « 1 an 4 mois », « 18 mois » ------------------------------------
  R(/^(\d+) ans? (\d+) mois$/, function (_, a, m) { return annees(a) + ' ' + m + (m === '1' ? ' month' : ' months'); });
  R(/^([\d.,]+) ans?$/, function (_, a) { return annees(a); });
  R(/^(\d+) mois$/, function (_, m) { return m + (m === '1' ? ' month' : ' months'); });
  R(/^(\d+) ans? fixe$/, function (_, a) { return a + '-year fixed'; });
  R(/^(\d+) sem\.$/, function (_, n) { return n + ' wk'; });

  // --- Calculateur de versement ------------------------------------------------------------
  P('Taux : {n}% du prêt de base', 'Rate: {1}% of the base loan');
  P('Dont ≈ {m}/mois pour la prime SCHL', 'Of which ≈ {1}/month for the CMHC premium');
  P('taxes {m}/mois', 'taxes {1}/month');
  P('chauffage {m}/mois', 'heating {1}/month');
  P('condo (50%) {m}/mois', 'condo (50%) {1}/month');
  P('≈ {n}% du prix', '≈ {1}% of the price');
  P('La mise de fonds minimale requise est de {m} ({n}% du prix d’achat).', 'The minimum required down payment is {1} ({2}% of the purchase price).');
  P('{m} /mois', '{1} /month');
  P('{m}/mois', '{1}/month');
  P('{m} / mois', '{1} / month');
  P('≈ {m}/mois', '≈ {1}/month');

  // --- Simulateur et calculateur express ---------------------------------------------------
  P('Mise de fonds insuffisante pour la capacité maximale. Prix limité à {m}.', 'Down payment insufficient for maximum capacity. Price limited to {1}.');
  P('C’est votre mise de fonds qui fixe ce prix : votre revenu suffirait pour une propriété de {m}, avec une mise de {m}.',
    'Your down payment is what sets this price: your income would be enough for a property of {1}, with a down payment of {2}.');
  R(/^Prêt (assuré|conventionnel) de ([+−-]?\$[\d,]+(?:\.\d+)?) · ([+−-]?\$[\d,]+(?:\.\d+)?)\/mois$/, function (_, t, a, b) {
    return (t === 'assuré' ? 'Insured' : 'Conventional') + ' loan of ' + a + ' · ' + b + '/month';
  });

  // --- Calculateur de pénalité ---------------------------------------------------------------
  P("Environ {m} si vous brisez votre hypothèque aujourd'hui", 'About {1} if you break your mortgage today');
  P('Voici le lien à partager : {t}', 'Here is the link to share: {1}');

  // --- Simulateur de refinancement -----------------------------------------------------------
  P('sur ≈ {n} an restant', 'over ≈ {1} year remaining');
  P('sur ≈ {n} ans restants', 'over ≈ {1} years remaining');
  P("Dépasse l'équité disponible (max {m}).", 'Exceeds the available equity (max {1}).');
  P('Vous épargnez {m} net {h} (dont {m} grâce à la consolidation de dettes).', 'You save {1} net {2} (of which {3} thanks to debt consolidation).');
  P('Vous épargnez {m} net {h}, coûts inclus.', 'You save {1} net {2}, costs included.');
  P('Économie nette de {m}, mais le point mort est long — votre durée de détention compte.', 'Net savings of {1}, but the break-even point is long — how long you hold the property matters.');
  P("Même avec {m} d'économies sur les dettes, les coûts ({m}) dépassent les économies.", 'Even with {1} of savings on debts, the costs ({2}) exceed the savings.');
  P("Les coûts dépassent les économies d'intérêts ({m} de perte nette).", 'The costs exceed the interest savings ({1} net loss).');
  P("Les coûts ({m}) dépassent les économies d'intérêts ({m}) sur cette période.", 'The costs ({1}) exceed the interest savings ({2}) over this period.');
  P("Dont {m} d'effet taux", 'Of which {1} from the rate effect');
  P("Avec l'amortissement de {n} ans, votre versement réel est {m}/mois ({m}/mois de moins) — c'est l'allongement, pas le taux. Intérêts totaux : {m}.",
    'With the {1}-year amortization, your actual payment is {2}/month ({3}/month less) — it comes from the longer amortization, not the rate. Total interest: {4}.');
  P("Avec l'amortissement de {n} ans, votre versement réel grimpe à {m}/mois ({m}/mois) : vous remboursez plus vite. L'économie d'intérêts qui en découle ({m}) vient du remboursement accéléré, pas du taux.",
    'With the {1}-year amortization, your actual payment rises to {2}/month ({3}/month): you pay off faster. The resulting interest savings ({4}) come from the accelerated repayment, not the rate.');
  P('⚠️ Amortissement prolongé de {n} mois vs le restant actuel', '⚠️ Amortization extended by {1} months vs. the current remainder');
  P('⚠️ Amortissement raccourci de {n} mois vs le restant actuel', '⚠️ Amortization shortened by {1} months vs. the current remainder');
  P('Intérêts sur {n} ans', 'Interest over {1} years');
  P('⚠️ Le nouveau solde ({m}) représente {n}% de la valeur.', '⚠️ The new balance ({1}) represents {2}% of the value.');
  P('Le refinancement conventionnel est limité à 80% (max {m}).', 'Conventional refinancing is limited to 80% (max {1}).');
  P("Réduisez le dégagement et/ou les dettes consolidées d'environ {m}.", 'Reduce the cash-out and/or the consolidated debts by about {1}.');
  P('En intégrant {n} dette au taux hypothécaire', 'By rolling {1} debt into the mortgage rate');
  P('En intégrant {n} dettes au taux hypothécaire', 'By rolling {1} debts into the mortgage rate');
  P('({n}%), vous remplacez {m}/mois', '({1}%), you replace {2}/month');
  P('{m}/mois.', '{1}/month.');
  P("Économie d'intérêts estimée à {m} sur la période.", 'Estimated interest savings of {1} over the period.');
  P('Économie nette {h}', 'Net savings {1}');
  P("Économies d'intérêts hypothécaires {m} + consolidation {m} − coûts {m}.", 'Mortgage interest savings {1} + consolidation {2} − costs {3}.');
  P("Économies d'intérêts {m} moins les coûts {m}.", 'Interest savings {1} less the costs {2}.');

  // --- Détail du calcul de pénalité : un long texte dont seuls les chiffres changent ----------
  var F = core.frag;
  [
    ['**Méthode retenue :**', '**Method used:**'],
    ['Méthode des taux affichés (grandes banques)', 'Posted rate method (big banks)'],
    ['Méthode du taux obligataire', 'Bond-yield method'],
    ['Méthode des taux réels/contractuels (prêteurs virtuels)', 'Actual/contract rate method (virtual lenders)'],
    ['**Mois restants au terme :**', '**Months remaining in the term:**'],
    ['(fin :', '(ends:'],
    ['**Terme de comparaison :**', '**Comparison term:**'],
    ['**Pénalité de 3 mois d\'intérêts :**', '**3 months\' interest penalty:**'],
    ['**Pénalité IRD :**', '**IRD penalty:**'],
    ['Taux de référence :', 'Reference rate:'],
    ['Taux de comparaison (', 'Comparison rate ('],
    ['Écart ≤ 0 → IRD = $0', 'Gap ≤ 0 → IRD = $0'],
    ['Écart :', 'Gap:'],
    ['**Pénalité estimée : MAX(3 mois, IRD) =', '**Estimated penalty: MAX(3 months, IRD) ='],
    ['Avec un prêteur à taux réel (ex. First National, MCAP),', 'With an actual-rate lender (e.g. First National, MCAP),'],
    ['votre pénalité serait approximativement de', 'your penalty would be approximately'],
    ['de moins)', 'less)'],
    ['Pénalité = ', 'Penalty = '],
    ['Capital + intérêts', 'Principal + interest'],
    [' chauffage ', ' heating '],
    ['/mois', '/month'],
    ['Dont ', 'Of which '],
    [' d\'effet taux et ', ' from the rate effect and '],
    [' d\'amortissement allongé.', ' from the longer amortization.'],
    [' d\'amortissement raccourci.', ' from the shorter amortization.'],
    [' mois)', ' months)'],
    [' mois', ' months'],
    [' ans)', ' years)'],
    [' an)', ' year)'],
  ].forEach(function (p) { F(p[0], p[1]); });

  // --- Taux, fraîcheur, témoignages ---------------------------------------------------------
  R(/^Taux mis à jour il y a (\d+) minutes?\.$/, function (_, n) { return 'Rates updated ' + n + (n === '1' ? ' minute' : ' minutes') + ' ago.'; });
  R(/^Taux mis à jour il y a (\d+) heures?\.$/, function (_, n) { return 'Rates updated ' + n + (n === '1' ? ' hour' : ' hours') + ' ago.'; });
  R(/^Taux mis à jour il y a (\d+) jours?\.$/, function (_, n) { return 'Rates updated ' + n + (n === '1' ? ' day' : ' days') + ' ago.'; });
  P('Aller au témoignage {n}', 'Go to testimonial {1}');

  // --- Pages de refinancement (funnels publicitaires) --------------------------------------
  P('Assez pour regrouper tes {m} de dettes en un seul paiement.', 'Enough to roll your {1} of debts into a single payment.');
  P('Erreur {n}', 'Error {1}');

  // --- Tableau d'amortissement ---------------------------------------------------------------
  R(/^Prêt de ([+−-]?\$[\d,]+(?:\.\d+)?) à ([\d.,]+)% sur ([\d.,]+) ans — versement (mensuel|aux deux semaines|hebdomadaire) de ([+−-]?\$[\d,]+(?:\.\d+)?)$/, function (_, a, t, n, f, v) {
    return 'Loan of ' + a + ' at ' + t + '% over ' + n + ' years — ' + { mensuel: 'monthly', 'aux deux semaines': 'bi-weekly', hebdomadaire: 'weekly' }[f] + ' payment of ' + v;
  });
  R(/^Versement (mensuel|aux deux semaines|hebdomadaire)$/, function (_, f) {
    return { mensuel: 'Monthly', 'aux deux semaines': 'Bi-weekly', hebdomadaire: 'Weekly' }[f] + ' payment';
  });
})();
