/**
 * La liste des guides — la page `/guides/` la lit d'ici.
 *
 * Ajouter un guide : l'inscrire ici, créer `src/pages/guides/<slug>.astro`, l'inscrire dans
 * `src/data/pagesTraduites.json` (sinon `/en/` le sert en 404 et le sitemap l'ignore), puis
 * traduire ses textes. `guides.test.ts` vérifie les trois premiers.
 *
 * **Un guide porte sa date de révision.** Il cite des règles qui bougent (seuils de mise de
 * fonds, plafond du RAP, test de résistance) : le lecteur doit savoir de quand date ce qu'il
 * lit, et un guide qu'on ne révise plus doit se voir.
 */

export interface Guide {
  readonly slug: string;
  /** Le titre de la carte sur `/guides/`. */
  readonly titre: string;
  readonly resume: string;
  /** Temps de lecture estimé (≈ 200 mots par minute). */
  readonly minutes: number;
  /** Dernière révision du contenu, `AAAA-MM-JJ`. */
  readonly revise: string;
}

export const GUIDES: readonly Guide[] = [
  {
    slug: 'premier-achat',
    titre: 'Premier achat au Québec, étape par étape',
    resume:
      "Budget, mise de fonds, RAP et CELIAPP, pré-approbation, frais à prévoir, signature chez le notaire : tout le parcours, dans l'ordre où il se présente.",
    minutes: 10,
    revise: '2026-11-08',
  },
  {
    slug: 'renouvellement',
    titre: 'Renouvellement hypothécaire, étape par étape',
    resume:
      "Quand commencer, lire l'offre de votre banque, rester ou changer de prêteur, revoir la structure, la pénalité en cours de terme : tout le calendrier, de six mois avant l'échéance à la signature.",
    minutes: 11,
    revise: '2026-11-08',
  },
  {
    slug: 'taux-fixe-ou-variable',
    titre: 'Taux fixe ou variable, comment choisir',
    resume:
      "Ce que chaque type de taux change à votre versement, à la pénalité de sortie et à votre marge de manœuvre : quatre questions pour décider selon votre situation, sans prévision de taux.",
    minutes: 9,
    revise: '2026-11-08',
  },
];

export function cheminGuide(slug: string): string {
  return `/guides/${slug}/`;
}

export function guideParSlug(slug: string): Guide {
  const guide = GUIDES.find((g) => g.slug === slug);
  if (!guide) throw new Error(`Guide inconnu : ${slug}`);
  return guide;
}

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/**
 * « novembre 2026 », calculé sur les chiffres — jamais `new Date('2026-11-01')`, lue comme
 * minuit UTC, qui tomberait la veille au Québec et, un 1er du mois, dans le mois précédent.
 * Le mois seul, sans le jour : c'est aussi ce qui garde la clé de traduction stable.
 */
export function moisRevision(revise: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(revise);
  const mois = m ? MOIS[Number(m[2]) - 1] : undefined;
  if (!m || !mois) throw new Error(`Date de révision invalide : ${revise}`);
  return `${mois} ${m[1]}`;
}
