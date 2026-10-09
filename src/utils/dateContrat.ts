/**
 * Les cases de date du contrat de courtage : un calendrier à l'écran, une date en toutes
 * lettres sur le PDF.
 *
 * Le calendrier (`<input type="date">`) parle ISO (`2027-04-30`) ; le contrat, lui, a
 * toujours porté « 30 avril 2027 », et c'est ce texte que le serveur reçoit, estampe et
 * conserve. Rien ne change donc côté serveur : la conversion se fait dans le navigateur, à
 * l'aller (`versTexteContrat`) comme au retour (`depuisTexteContrat`, pour préremplir une
 * correction).
 *
 * Calcul fait sur les chiffres, jamais par `new Date(...)` : une date ISO lue par `Date`
 * est minuit UTC, donc la veille au Québec — le 30 avril deviendrait le 29.
 *
 * @module dateContrat
 */

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/** Retire les accents et met en minuscules, pour reconnaître « Fevrier » comme « février ». */
function plier(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const MOIS_PLIES = MOIS.map(plier);

function iso(annee: number, mois: number, jour: number): string | null {
  if (annee < 1900 || annee > 2200 || mois < 1 || mois > 12 || jour < 1) return null;
  const jours = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  if (jour > jours) return null;
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/** `2027-04-30` → « 30 avril 2027 » ; « 1er » pour le premier du mois. Vide si invalide. */
export function versTexteContrat(valeurIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeurIso.trim());
  if (!m) return '';
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (iso(annee, mois, jour) === null) return '';
  return `${jour === 1 ? '1er' : jour} ${MOIS[mois - 1]} ${annee}`;
}

/**
 * L'inverse : reconnaît ce que le contrat a pu porter jusqu'ici — « 30 avril 2027 »,
 * « 1er avril 2027 », `2027-04-30`, `30/04/2027` — et rend la date ISO du calendrier.
 * `null` si le texte n'est pas une date certaine : mieux vaut le signaler que deviner.
 */
export function depuisTexteContrat(texte: string): string | null {
  const t = plier(texte.trim()).replace(/\s+/g, ' ');
  if (t === '') return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(?:le )?(\d{1,2})(?:er)? ([a-z]+)\.? (\d{4})$/.exec(t);
  if (m) {
    const nom = m[2] ?? '';
    const index = MOIS_PLIES.findIndex((mois) => mois === nom || (nom.length >= 3 && mois.startsWith(nom)));
    if (index === -1) return null;
    return iso(Number(m[3]), index + 1, Number(m[1]));
  }

  return null;
}

/** La date du jour au format du calendrier, à l'heure de l'appareil. */
export function aujourdhuiIso(maintenant: Date = new Date()): string {
  return (
    iso(maintenant.getFullYear(), maintenant.getMonth() + 1, maintenant.getDate()) ?? ''
  );
}
