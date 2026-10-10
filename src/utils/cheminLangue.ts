/**
 * Un chemin du site, dans la langue de la page courante.
 *
 * Les scripts des formulaires et des calculateurs naviguent par code (« /merci » après un
 * envoi, « /amortissement?… » depuis le calculateur). Sur une page /en/, cette navigation doit
 * rester dans /en/ : sans ça, un visiteur qui vient d'envoyer un formulaire en anglais
 * arriverait sur une page de remerciement française.
 */
export function cheminLangue(chemin: string): string {
  const en = location.pathname === '/en' || location.pathname.startsWith('/en/');
  if (!en) return chemin;
  const [base, ...reste] = chemin.split(/(?=[?#])/);
  const sansBarre = (base ?? '').replace(/\/+$/, '');
  return `/en${sansBarre}/${reste.join('')}`;
}
