// La frise de l'écran de fin de /signer-contrat : où en est le contrat, une fois signé.
//
// Module pur, pour que la règle se teste sans navigateur. Tant que la suite tenait dans une
// liste grise de deux ou trois phrases, rien ne disait qui avait déjà signé ni qui venait
// ensuite — et c'est précisément ce que se demande celui qui vient de signer.
//
// Ce que la frise affirme doit rester vrai du système : la signature est séquentielle, la
// courtière signe en dernier, et le seul courriel qu'un emprunteur reçoit après avoir signé
// est celui du contrat complet. Aucune étape n'annonce un accusé immédiat ni un délai.

export type EtatEtape = 'fait' | 'courant' | 'avenir';

export interface EtapeFrise {
  etat: EtatEtape;
  texte: string;
  /** Précision sous le texte : l'heure de la signature, l'adresse de réception. */
  detail?: string;
  /** Vrai pour l'étape de réception : l'écran y accroche l'adresse et le lien de correction. */
  reception?: boolean;
}

export interface SignataireFrise {
  nom: string;
  /** Avait déjà signé au chargement de la page. */
  signe: boolean;
}

export interface OptionsFrise {
  /** Tous les emprunteurs, dans l'ordre du contrat — l'ordre de signature. */
  signataires: SignataireFrise[];
  /** Le rang de celui qui vient de signer. */
  index: number;
  prenomCourtiere: string;
  /** L'horodatage serveur de sa signature (ISO), s'il a été renvoyé. */
  signeLe?: string | null;
}

const ZONE = 'America/Toronto';

/**
 * « 10 octobre 2026, 11 h 50 », à l'heure du Québec. L'instant vient du serveur, jamais de
 * l'horloge du téléphone : c'est celui que porte la trace de preuve. `null` s'il est illisible.
 */
export function formaterHorodatage(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const jour = new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: ZONE,
  }).format(date);
  const heure = new Intl.DateTimeFormat('fr-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ZONE,
  }).format(date);
  return `${jour}, ${heure}`;
}

/**
 * Les étapes, du premier emprunteur à la réception du contrat signé. La première étape non
 * faite est « courante » : c'est celle qui attend quelqu'un.
 */
export function composerFrise(options: OptionsFrise): EtapeFrise[] {
  const { signataires, index, prenomCourtiere } = options;
  const etapes: EtapeFrise[] = [];

  signataires.forEach((signataire, i) => {
    if (i === index) {
      const quand = formaterHorodatage(options.signeLe);
      etapes.push({ etat: 'fait', texte: 'Vous avez signé', ...(quand ? { detail: quand } : {}) });
    } else if (signataire.signe) {
      etapes.push({ etat: 'fait', texte: `${signataire.nom} a signé` });
    } else {
      etapes.push({ etat: 'avenir', texte: `${signataire.nom} lit le contrat et signe à son tour` });
    }
  });

  etapes.push({
    etat: 'avenir',
    texte: `${prenomCourtiere} relit le contrat et appose sa signature — c’est la dernière`,
  });
  etapes.push({ etat: 'avenir', texte: 'Vous recevez le contrat signé par courriel', reception: true });

  const courante = etapes.find((etape) => etape.etat === 'avenir');
  if (courante) courante.etat = 'courant';
  return etapes;
}

/**
 * Le courriel prérempli de « Ce n'est pas la bonne adresse ? ». Il nomme le contrat et le
 * signataire pour que la courtière s'y retrouve sans avoir à demander de quoi il s'agit ; il
 * part de la messagerie du client, rien ne transite par le site.
 */
export function lienCorrectionAdresse(options: {
  courrielCourtiere: string;
  prenomCourtiere: string;
  nom: string;
  courriel: string;
}): string {
  const sujet = 'Contrat de courtage — adresse courriel à corriger';
  const corps =
    `Bonjour ${options.prenomCourtiere},\n\n` +
    `Je viens de signer le contrat de courtage. L’adresse où le recevoir (${options.courriel}) ` +
    `n’est pas la bonne. La bonne adresse est : \n\n${options.nom}`;
  return `mailto:${options.courrielCourtiere}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}
