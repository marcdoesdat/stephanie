import { describe, expect, it } from 'vitest';
import {
  CHAMPS_CONSERVES,
  DOCUMENTS,
  ETAPES,
  ETAPES_CLIENT,
  ORDRE_ETAPES,
  depuisDemande,
  documentsRequis,
  etapeClot,
  etapeSuivante,
  extraireProfil,
  parserDonneesDossier,
  rangEtape,
  type CleEtape,
  type ProfilDemande,
} from './dossiersClients';

/** Les clés de `/demande` que le CRM ne doit jamais retenir — le verrou du principe n°1. */
const CHAMPS_INTERDITS = [
  'date_naissance',
  'nas',
  'adresse',
  'employeur',
  'titre_poste',
  'revenu_base',
  'revenu_extra',
  'autres_revenus',
  'auto_evaluation_credit',
  'faillite_passee',
  'paiement_dettes',
  'types_dettes',
  'personnes_charge',
  'mise_montant',
  'consentement_credit',
  'anciennete',
  'etat_civil',
];

describe('catalogue des étapes', () => {
  it('donne à chaque étape un libellé destiné au client', () => {
    for (const [cle, etape] of Object.entries(ETAPES)) {
      expect(etape.libelle.length, cle).toBeGreaterThan(0);
      expect(etape.libelleClient.length, cle).toBeGreaterThan(0);
    }
  });

  it('explique au client chaque étape qui lui est montrée', () => {
    for (const [cle, etape] of Object.entries(ETAPES)) {
      if (!etape.visibleClient) continue;
      expect(etape.explicationClient.length, cle).toBeGreaterThan(20);
    }
  });

  it('ne montre jamais l’étape « perdu » au client', () => {
    expect(ETAPES.perdu.visibleClient).toBe(false);
    expect(ETAPES_CLIENT).not.toContain('perdu');
  });

  it('tient « perdu » hors de la progression — ce n’est pas une étape qu’on atteint en avançant', () => {
    expect(ORDRE_ETAPES as readonly string[]).not.toContain('perdu');
    expect(rangEtape('perdu')).toBe(-1);
    expect(etapeSuivante('perdu')).toBeNull();
  });

  it('avance d’une étape à la suivante et s’arrête au bout', () => {
    expect(etapeSuivante('nouveau')).toBe('contact');
    expect(etapeSuivante('notaire')).toBe('finance');
    expect(etapeSuivante('finance')).toBeNull();
  });

  it('marque « financé » et « perdu » comme terminaux, et eux seuls', () => {
    const clos = (Object.keys(ETAPES) as CleEtape[]).filter(etapeClot);
    expect(clos.sort()).toEqual(['finance', 'perdu']);
  });
});

describe('documentsRequis', () => {
  it('sème talons de paie, lettre d’emploi et T4 pour un salarié', () => {
    const cles = documentsRequis({ statutEmploi: 'salarie', typeDemande: 'achat' }).map((l) => l.cle);
    expect(cles).toContain('talons_paie');
    expect(cles).toContain('lettre_emploi');
    expect(cles).toContain('t4');
    expect(cles).not.toContain('avis_cotisation');
  });

  it('sème avis de cotisation et états financiers pour un travailleur autonome', () => {
    const cles = documentsRequis({ statutEmploi: 'travailleur_autonome', typeDemande: 'achat' }).map((l) => l.cle);
    expect(cles).toContain('avis_cotisation');
    expect(cles).toContain('etats_financiers');
    expect(cles).not.toContain('talons_paie');
  });

  it('réclame les pièces du co-emprunteur séparément de celles de l’emprunteur', () => {
    const lignes = documentsRequis({
      statutEmploi: 'salarie',
      coEmprunteur: 'deux',
      coStatutEmploi: 'travailleur_autonome',
      typeDemande: 'achat',
    });
    expect(lignes).toContainEqual({ cle: 'talons_paie', pourQui: 'emprunteur' });
    expect(lignes).toContainEqual({ cle: 'avis_cotisation', pourQui: 'co_emprunteur' });
    // Deux pièces d'identité : ce sont bien deux choses à réclamer, pas une case pour deux.
    expect(lignes.filter((l) => l.cle === 'piece_identite')).toHaveLength(2);
  });

  it('ne sème rien pour un statut sans emploi plutôt que des documents inapplicables', () => {
    const lignes = documentsRequis({ statutEmploi: 'sans_emploi', typeDemande: 'achat' });
    const cles = lignes.map((l) => l.cle);
    expect(cles).not.toContain('talons_paie');
    expect(cles).not.toContain('avis_cotisation');
    expect(cles).toContain('piece_identite');
  });

  it('distingue le refinancement de l’achat', () => {
    const refi = documentsRequis({ typeDemande: 'refinancement' }).map((l) => l.cle);
    expect(refi).toContain('releve_hypothecaire');
    expect(refi).toContain('compte_taxes');
    expect(refi).not.toContain('preuve_mise_de_fonds');

    const achat = documentsRequis({ typeDemande: 'achat', promesseAchat: 'oui' }).map((l) => l.cle);
    expect(achat).toContain('preuve_mise_de_fonds');
    expect(achat).toContain('releves_bancaires');
    expect(achat).toContain('promesse_achat');
    expect(achat).not.toContain('releve_hypothecaire');
  });

  it('réclame la lettre de don, la preuve de vente, le condo et les baux quand le profil le dit', () => {
    expect(documentsRequis({ typeDemande: 'achat', sourceFonds: 'don' }).map((l) => l.cle)).toContain('lettre_don');
    expect(documentsRequis({ ventePropriete: 'oui' }).map((l) => l.cle)).toContain('preuve_vente');
    expect(documentsRequis({ typePropriete: 'condo' }).map((l) => l.cle)).toContain('declaration_copropriete');
    expect(documentsRequis({ usagePropriete: 'revenus' }).map((l) => l.cle)).toContain('baux_locataires');
  });

  it('ne sème jamais deux fois la même ligne', () => {
    // « vente » comme source de fonds *et* propriété à vendre : deux règles, une seule pièce.
    const lignes = documentsRequis({ typeDemande: 'achat', sourceFonds: 'vente', ventePropriete: 'oui' });
    const signatures = lignes.map((l) => `${l.cle}/${l.pourQui}`);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('ne sème que des clés qui existent au catalogue', () => {
    const profils: ProfilDemande[] = [
      { statutEmploi: 'salarie', typeDemande: 'achat', promesseAchat: 'oui', sourceFonds: 'don' },
      { statutEmploi: 'travailleur_autonome', typeDemande: 'refinancement', typePropriete: 'condo' },
      { coEmprunteur: 'deux', coStatutEmploi: 'commission', usagePropriete: 'revenus', ventePropriete: 'oui' },
      {},
    ];
    for (const profil of profils) {
      for (const ligne of documentsRequis(profil)) {
        expect(Object.hasOwn(DOCUMENTS, ligne.cle), ligne.cle).toBe(true);
      }
    }
  });

  it('donne à chaque document une raison — sans quoi la liste est une corvée', () => {
    for (const [cle, doc] of Object.entries(DOCUMENTS)) {
      expect(doc.libelle.length, cle).toBeGreaterThan(0);
      expect(doc.pourquoi.length, cle).toBeGreaterThan(20);
    }
  });
});

describe('CHAMPS_CONSERVES — le verrou du principe « suivi, pas dossier de crédit »', () => {
  it('ne retient aucun champ sensible de /demande', () => {
    const conserves = Object.keys(CHAMPS_CONSERVES);
    for (const interdit of CHAMPS_INTERDITS) {
      expect(conserves, interdit).not.toContain(interdit);
    }
  });

  it('laisse tomber tout champ hors whitelist, même envoyé par le client', () => {
    const profil = extraireProfil({
      type_demande: 'achat',
      statut_emploi: 'salarie',
      revenu_base: '95000',
      date_naissance: '1988-03-02',
      auto_evaluation_credit: 'excellent',
      faillite_passee: 'oui_liberee',
      nas: '123 456 789',
    });
    expect(profil.typeDemande).toBe('achat');
    expect(profil.statutEmploi).toBe('salarie');
    expect(JSON.stringify(profil)).not.toMatch(/95000|1988|excellent|liberee|123/);
  });

  it('accepte aussi bien les clés du formulaire que celles du profil', () => {
    expect(extraireProfil({ type_demande: 'refinancement' }).typeDemande).toBe('refinancement');
    expect(extraireProfil({ typeDemande: 'refinancement' }).typeDemande).toBe('refinancement');
  });
});

describe('parserDonneesDossier', () => {
  const VALIDE = { nom: 'Marie Tremblay', courriel: 'Marie.Tremblay@Exemple.CA', telephone: '450 555-1234' };

  it('accepte une fiche valide et normalise le courriel', () => {
    const resultat = parserDonneesDossier(VALIDE);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.valeur.courriel).toBe('marie.tremblay@exemple.ca');
    expect(resultat.valeur.nom).toBe('Marie Tremblay');
  });

  it('refuse un nom absent ou une adresse invalide', () => {
    expect(parserDonneesDossier({ ...VALIDE, nom: 'M' }).ok).toBe(false);
    expect(parserDonneesDossier({ ...VALIDE, courriel: 'pas-une-adresse' }).ok).toBe(false);
    expect(parserDonneesDossier(null).ok).toBe(false);
  });
});

describe('depuisDemande', () => {
  const DEMANDE = {
    prenom: 'Marie',
    nom: 'Tremblay',
    courriel: 'marie@exemple.ca',
    telephone: '450 555-1234',
    type_demande: 'achat',
    statut_emploi: 'salarie',
    date_naissance: '1988-03-02',
    revenu_base: '95000',
    auto_evaluation_credit: 'excellent',
  };

  it('compose un nom complet à partir du prénom et du nom', () => {
    const resultat = depuisDemande(DEMANDE);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.valeur.nom).toBe('Marie Tremblay');
  });

  it('n’emporte aucune donnée financière dans le dossier', () => {
    const resultat = depuisDemande(DEMANDE);
    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(JSON.stringify(resultat.valeur)).not.toMatch(/95000|1988-03-02|excellent/);
    expect(resultat.valeur.profil.typeDemande).toBe('achat');
  });

  it('refuse une demande sans adresse courriel exploitable', () => {
    expect(depuisDemande({ ...DEMANDE, courriel: '' }).ok).toBe(false);
  });
});
