import { describe, expect, it } from 'vitest';
import {
  DUREE_REPRISE_MS,
  ETAPES,
  bilanDemande,
  decoderReprise,
  encoderReprise,
  etapeParCle,
  etapeReprise,
  etapesApplicables,
  indexDansParcours,
  lectureCharge,
  requisManquants,
} from './demandeFinancement';

/** Une demande d'achat remplie jusqu'au bout. */
const ACHAT_COMPLET: Record<string, unknown> = {
  type_demande: 'achat',
  nom: 'Marie Tremblay',
  telephone: '514 555-1234',
  courriel: 'marie@exemple.ca',
  naissance: '1990-07-01',
  adresse: '123 rue Principale',
  ville: 'Repentigny',
  code_postal: 'J5Y 1A1',
  adresse_3ans: 'oui',
  statut_residence: 'citoyen',
  etat_civil: 'celibataire',
  co_emprunteur: 'seul',
  situation_logement: 'locataire',
  employeur: 'Desjardins',
  titre_poste: 'Analyste',
  statut_emploi: 'salarie',
  anciennete: '2a_5ans',
  revenu_base: '75000',
  auto_evaluation_credit: 'bon',
  mise_montant: '45000',
  source_fonds: 'epargne',
  fonds_90jours: 'oui',
  types_dettes: ['aucune_dette'],
  pref_taux: 'fixe',
  promesse_achat: 'non',
  pref_contact: 'texto',
};

const lire = (charge: Record<string, unknown>) => lectureCharge(charge);

describe('le catalogue', () => {
  it('commence par de quoi joindre le client : c’est le minimum d’un envoi anticipé', () => {
    const premiere = ETAPES[0]!;
    expect(premiere.cle).toBe('projet');
    expect(premiere.requis.map((r) => r.champ)).toEqual(['type_demande', 'nom', 'telephone', 'courriel']);
  });

  it('n’a ni clé ni champ en double', () => {
    const cles = ETAPES.map((e) => e.cle);
    expect(new Set(cles).size).toBe(cles.length);
    const champs = ETAPES.flatMap((e) => e.champs);
    expect(new Set(champs).size).toBe(champs.length);
  });

  it('ne réclame que des champs de l’étape', () => {
    for (const etape of ETAPES) {
      for (const requis of etape.requis) expect(etape.champs, `${etape.cle}/${requis.champ}`).toContain(requis.champ);
    }
  });

  it('reconnaît ses clés et refuse les autres', () => {
    expect(etapeParCle('emploi')?.titre).toBe('Emploi et revenus');
    expect(etapeParCle('inventee')).toBeNull();
    expect(etapeParCle('')).toBeNull();
  });
});

describe('les parcours', () => {
  it('l’achat passe par la mise de fonds, pas par le prêt actuel', () => {
    const cles = etapesApplicables(lire({ type_demande: 'achat' })).map((e) => e.cle);
    expect(cles).toContain('mise_de_fonds');
    expect(cles).not.toContain('pret_actuel');
  });

  it('le refinancement passe par le prêt actuel, pas par la mise de fonds', () => {
    const cles = etapesApplicables(lire({ type_demande: 'refinancement' })).map((e) => e.cle);
    expect(cles).toContain('pret_actuel');
    expect(cles).not.toContain('mise_de_fonds');
  });

  it('compte le même nombre d’étapes dans les deux parcours', () => {
    const achat = etapesApplicables(lire({ type_demande: 'achat' })).length;
    const refi = etapesApplicables(lire({ type_demande: 'refinancement' })).length;
    expect(achat).toBe(refi);
  });

  it('ne demande pas de promesse d’achat à qui refinance sa maison', () => {
    const propriete = etapeParCle('propriete')!;
    expect(requisManquants(propriete, lire({ type_demande: 'refinancement' }))).toHaveLength(0);
    expect(requisManquants(propriete, lire({ type_demande: 'achat' })).map((r) => r.champ)).toEqual(['promesse_achat']);
  });

  it('n’exige le co-emprunteur que s’il y en a un', () => {
    const co = etapeParCle('co_emprunteur')!;
    expect(requisManquants(co, lire({ co_emprunteur: 'seul' }))).toHaveLength(0);
    expect(requisManquants(co, lire({ co_emprunteur: 'deux' })).map((r) => r.champ)).toEqual(['co_nom', 'co_naissance']);
  });
});

describe('les formats', () => {
  const projet = etapeParCle('projet')!;
  const base = { type_demande: 'achat', nom: 'Marie Tremblay', telephone: '514 555-1234', courriel: 'marie@exemple.ca' };

  it('accepte un courriel et un numéro à dix chiffres', () => {
    expect(requisManquants(projet, lire(base))).toHaveLength(0);
  });

  it('refuse un numéro sans indicatif régional', () => {
    expect(requisManquants(projet, lire({ ...base, telephone: '555-1234' })).map((r) => r.champ)).toEqual(['telephone']);
  });

  it('refuse un courriel sans domaine', () => {
    expect(requisManquants(projet, lire({ ...base, courriel: 'marie@exemple' })).map((r) => r.champ)).toEqual(['courriel']);
  });
});

describe('le bilan', () => {
  it('dit complète une demande remplie jusqu’au bout', () => {
    expect(bilanDemande(lire(ACHAT_COMPLET)).complete).toBe(true);
  });

  it('nomme les étapes laissées vides et les réponses requises qui manquent', () => {
    // Le client s'est arrêté après « Situation actuelle », sans répondre au logement.
    const charge = {
      type_demande: 'achat', nom: 'Marie Tremblay', telephone: '514 555-1234', courriel: 'marie@exemple.ca',
      naissance: '1990-07-01', adresse: '123 rue Principale', ville: 'Repentigny', code_postal: 'J5Y 1A1',
      adresse_3ans: 'oui', statut_residence: 'citoyen', etat_civil: 'celibataire',
      co_emprunteur: 'seul', premier_acheteur: 'oui',
    };
    const bilan = bilanDemande(lire(charge));
    expect(bilan.complete).toBe(false);

    const parCle = Object.fromEntries(bilan.aCompleter.map((e) => [e.cle, e]));
    expect(parCle.projet).toBeUndefined();
    expect(parCle.identite).toBeUndefined();
    expect(parCle.situation).toEqual({ cle: 'situation', titre: 'Situation actuelle', vide: false, manquants: ['Situation de logement'] });
    expect(parCle.emploi?.vide).toBe(true);
    expect(parCle.emploi?.manquants).toContain('Employeur');
    // Sans réponse requise, une étape vide est quand même signalée.
    expect(parCle.dettes).toEqual({ cle: 'dettes', titre: 'Dettes et obligations', vide: true, manquants: [] });
    // Hors parcours : un achat n'a pas de prêt actuel à décrire.
    expect(parCle.pret_actuel).toBeUndefined();
  });

  it('suit l’ordre des étapes', () => {
    const bilan = bilanDemande(lire({ type_demande: 'refinancement', nom: 'Luc Roy', telephone: '4505559876', courriel: 'luc@ex.ca' }));
    const ordre = ETAPES.map((e) => e.cle);
    const cles = bilan.aCompleter.map((e) => e.cle);
    expect(cles).toEqual([...cles].sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b)));
    expect(cles[0]).toBe('pret_actuel');
  });
});

describe('la lecture de la charge utile', () => {
  it('nettoie les chaînes, joint les cases cochées et lit les cases à cocher booléennes', () => {
    const l = lectureCharge({ a: '  x  ', b: ['un', '', 'deux'], c: true, d: false, e: 12, f: null });
    expect(l('a')).toBe('x');
    expect(l('b')).toBe('un, deux');
    expect(l('c')).toBe('oui');
    expect(l('d')).toBe('');
    expect(l('e')).toBe('');
    expect(l('f')).toBe('');
    expect(l('absent')).toBe('');
  });
});

describe('la reprise après un rechargement', () => {
  const MAINTENANT = Date.UTC(2026, 4, 14, 15);
  const CHAMPS = {
    type_demande: ['achat'],
    nom: ['Marie Tremblay'],
    telephone: ['514 555-1234'],
    courriel: ['marie@exemple.ca'],
    types_dettes: ['pret_auto', 'cartes_credit'],
    message: [''],
  };

  it('fait l’aller-retour, accents et cases multiples compris', () => {
    const reprise = decoderReprise(encoderReprise('identite', { ...CHAMPS, ville: ['Saint-Jérôme'] }, MAINTENANT), MAINTENANT);
    expect(reprise?.etape).toBe('identite');
    expect(reprise?.champs.ville).toEqual(['Saint-Jérôme']);
    expect(reprise?.champs.types_dettes).toEqual(['pret_auto', 'cartes_credit']);
    // Une valeur vide n'est pas gardée.
    expect(reprise?.champs.message).toBeUndefined();
  });

  it('ne garde jamais le consentement : il se donne au moment d’envoyer', () => {
    const brut = encoderReprise('dernieres', { ...CHAMPS, consentement: ['oui'], company: ['robot'] }, MAINTENANT);
    expect(brut).not.toContain('consentement');
    expect(brut).not.toContain('robot');
    // Ni écrit, ni relu : une valeur glissée à la main n'est pas reprise non plus.
    const trafique = JSON.stringify({ v: 1, ts: MAINTENANT, etape: 'dernieres', champs: { nom: ['A B'], consentement: ['oui'] } });
    expect(decoderReprise(trafique, MAINTENANT)?.champs.consentement).toBeUndefined();
  });

  it('ne reprend pas des réponses de plus de 24 heures, ni datées du futur', () => {
    const brut = encoderReprise('emploi', CHAMPS, MAINTENANT);
    expect(decoderReprise(brut, MAINTENANT + DUREE_REPRISE_MS - 1)).not.toBeNull();
    expect(decoderReprise(brut, MAINTENANT + DUREE_REPRISE_MS + 1)).toBeNull();
    expect(decoderReprise(brut, MAINTENANT - 10 * 60_000)).toBeNull();
  });

  it('écarte champ par champ ce qui n’a pas la bonne forme, plutôt que de tout croire', () => {
    const brut = JSON.stringify({
      v: 1,
      ts: MAINTENANT,
      etape: 'etape_inventee',
      champs: {
        nom: ['Marie Tremblay', 42, null],
        'name"]': ['x'],
        courriel: 'pas-un-tableau',
        message: ['x'.repeat(5000)],
      },
    });
    const reprise = decoderReprise(brut, MAINTENANT);
    expect(reprise).toEqual({ etape: 'projet', champs: { nom: ['Marie Tremblay'] } });
  });

  it('rend null pour un contenu illisible ou vide', () => {
    expect(decoderReprise(null, MAINTENANT)).toBeNull();
    expect(decoderReprise('{pas du json', MAINTENANT)).toBeNull();
    expect(decoderReprise(JSON.stringify({ v: 2, ts: MAINTENANT, champs: { nom: ['A'] } }), MAINTENANT)).toBeNull();
    expect(decoderReprise(encoderReprise('emploi', { message: [''] }, MAINTENANT), MAINTENANT)).toBeNull();
  });

  it('reprend à l’étape demandée quand tout ce qui la précède est rempli', () => {
    expect(etapeReprise(lire(ACHAT_COMPLET), 'emploi')).toBe('emploi');
  });

  it('reprend au premier trou plutôt qu’au-delà', () => {
    const { adresse: _sansAdresse, ...charge } = ACHAT_COMPLET;
    expect(etapeReprise(lire(charge), 'emploi')).toBe('identite');
  });

  it('ramène dans le parcours une étape qui n’y est plus', () => {
    // Le client était à la mise de fonds, puis a choisi « refinancement » : l'étape disparaît.
    const charge = { ...ACHAT_COMPLET, type_demande: 'refinancement', refi_solde: '250000', refi_valeur: '450000' };
    expect(etapeReprise(lire(charge), 'mise_de_fonds')).toBe('credit');
    const parcours = etapesApplicables(lire(charge));
    expect(parcours[indexDansParcours('mise_de_fonds', parcours)]?.cle).toBe('credit');
  });
});
