/**
 * Tests des portes d'entrée du carnet.
 *
 * Ce que ces tests protègent avant tout : **aucun renseignement financier déclaré ne
 * franchit la porte.** `/refinancement` recueille revenu brut, cote de crédit, faillite,
 * dettes, solde et valeur marchande ; ces champs continuent de ne vivre que dans le courriel
 * interne. Un adaptateur qui en laisserait passer un ferait du carnet, silencieusement, une
 * base de données financière nominative.
 *
 * Ensuite : les noms de champs divergent d'un formulaire à l'autre, et une coquille de
 * mappage ne se voit pas — elle produit une fiche sans téléphone, ou sans nom, qu'on ne
 * remarque que le jour où on veut rappeler la personne.
 */
import { describe, expect, it } from 'vitest';
import {
  depuisCalculateur,
  depuisContact,
  depuisOutils,
  depuisPartenaire,
  depuisPenalite,
  depuisRappel,
  depuisRefinancement,
  depuisRefinancementV2,
} from './entreesProspect';
import type { DonneesDossier, Resultat } from './dossiersClients';

function valeur(resultat: Resultat<DonneesDossier>): DonneesDossier {
  if (!resultat.ok) throw new Error(`attendu ok, reçu : ${resultat.erreur}`);
  return resultat.valeur;
}

/* ------------------------------------------------------------------ */
/*  Charges utiles réalistes                                           */
/* ------------------------------------------------------------------ */

const RAPPEL = {
  nom: 'Marie Tremblay',
  courriel: 'marie@exemple.ca',
  telephone: '450 555-1234',
  type: 'Renouvellement',
  echeance: 'mars 2027',
  institution: 'Desjardins',
  details: 'Mon terme finit bientôt, j’aimerais comparer.',
  consentement: true,
};

const CONTACT = {
  prenom: 'Luc',
  nom: 'Roy',
  email: 'luc@exemple.ca',
  telephone: '450 555-9876',
  parcours: 'Premier achat',
  delai: '3 à 6 mois',
  prefcontact: 'Texto',
  message: 'On magasine encore.',
};

/** Le formulaire le plus indiscret du site — d'où le détail de cette charge utile. */
const REFI = {
  prenom: 'Ana',
  nom: 'Bergeron',
  courriel: 'ana@exemple.ca',
  cellulaire: '514 555-2222',
  but_refinancement: 'Consolider mes dettes',
  preteur_actuel: 'RBC — Banque Royale',
  fin_terme: 'septembre 2027',
  type_propriete: 'Maison unifamiliale',
  proprietaire: 'oui',
  // Rien de ce qui suit ne doit apparaître dans la fiche :
  revenu_brut: '112000',
  cote_credit: '780',
  faillite: 'oui_liberee',
  dettes_a_refinancer: '45000',
  solde_pret: '310000',
  valeur_marchande: '525000',
  type_revenu: 'salarie',
};

const REFI_V2 = {
  prenom: 'Bo',
  courriel: 'bo@exemple.ca',
  cellulaire: '514 555-3333',
  intention: 'Sortir du cash pour un projet',
  ville: 'Repentigny',
  solde_tranche: '250k_350k',
  valeur_tranche: '450k_600k',
};

const PARTENAIRE = {
  'nom-partenaire': 'Me Gagnon',
  profession: 'notaire',
  'contact-partenaire': 'gagnon@etude.ca',
  'client-nom': 'Camille Fortin',
  'client-telephone': '450 555-7777',
  'type-projet': 'Premier achat',
  notes: 'Promesse acceptée la semaine dernière.',
};

/* ------------------------------------------------------------------ */

describe('aucun chiffre déclaré ne franchit la porte', () => {
  it('laisse dehors revenus, crédit, faillite, dettes, solde et valeur de /refinancement', () => {
    const fiche = valeur(depuisRefinancement(REFI));
    const serialise = JSON.stringify(fiche);
    for (const interdit of ['112000', '780', 'liberee', '45000', '310000', '525000']) {
      expect(serialise, interdit).not.toContain(interdit);
    }
  });

  it('laisse dehors les tranches de /refinancement-v2', () => {
    const serialise = JSON.stringify(valeur(depuisRefinancementV2(REFI_V2)));
    expect(serialise).not.toContain('250k_350k');
    expect(serialise).not.toContain('450k_600k');
  });

  it('ne retient aucun montant simulé des calculateurs', () => {
    const versement = valeur(
      depuisCalculateur({
        nom: 'Ana',
        email: 'ana@exemple.ca',
        telephone: '514 555-1111',
        montant: '400000',
        versement: '2100',
        amortissement: '25',
        prime: '12000',
        cout: '187000',
      }),
    );
    const serialise = JSON.stringify(versement);
    for (const interdit of ['400000', '2100', '12000', '187000']) {
      expect(serialise, interdit).not.toContain(interdit);
    }

    const penalite = valeur(
      depuisPenalite({ prenom: 'Bo', email: 'bo@exemple.ca', telephone: '514 555-4444', penalite: '8400' }),
    );
    expect(JSON.stringify(penalite)).not.toContain('8400');
  });
});

describe('mappage des champs divergents', () => {
  it('/rappel — courriel et telephone, type traduit en clé', () => {
    const fiche = valeur(depuisRappel(RAPPEL));
    expect(fiche.nom).toBe('Marie Tremblay');
    expect(fiche.courriel).toBe('marie@exemple.ca');
    expect(fiche.telephone).toBe('450 555-1234');
    expect(fiche.profil.typeDemande).toBe('renouvellement');
    expect(fiche.notes).toContain('Desjardins');
    expect(fiche.notes).toContain('comparer');
  });

  it('/contact — email, prénom et nom recomposés, parcours traduit', () => {
    const fiche = valeur(depuisContact(CONTACT));
    expect(fiche.nom).toBe('Luc Roy');
    expect(fiche.courriel).toBe('luc@exemple.ca');
    expect(fiche.profil.typeDemande).toBe('achat');
    expect(fiche.profil.prefContact).toBe('Texto');
  });

  it('/contact — accepte « situation » quand « parcours » manque', () => {
    const fiche = valeur(depuisContact({ ...CONTACT, parcours: '', situation: 'Renouvellement / Refinancement' }));
    expect(fiche.profil.typeDemande).toBe('refinancement');
  });

  it('/refinancement — cellulaire devient téléphone, contexte utile conservé', () => {
    const fiche = valeur(depuisRefinancement(REFI));
    expect(fiche.nom).toBe('Ana Bergeron');
    expect(fiche.telephone).toBe('514 555-2222');
    expect(fiche.profil.typeDemande).toBe('refinancement');
    expect(fiche.notes).toContain('RBC');
    expect(fiche.notes).toContain('septembre 2027');
  });

  it('/refinancement-v2 — un prénom seul suffit à nommer la fiche', () => {
    const fiche = valeur(depuisRefinancementV2(REFI_V2));
    expect(fiche.nom).toBe('Bo');
    expect(fiche.notes).toContain('Repentigny');
  });

  it('/outils — reprend le message tel quel', () => {
    const fiche = valeur(
      depuisOutils({ prenom: 'Zoé', email: 'zoe@exemple.ca', telephone: '', message: 'Question sur la SCHL.' }),
    );
    expect(fiche.nom).toBe('Zoé');
    expect(fiche.notes).toContain('SCHL');
  });
});

describe('/partenaires — deux personnes, un formulaire', () => {
  it('sépare le référent du client référé', () => {
    const { referent, client } = depuisPartenaire(PARTENAIRE);
    expect(referent).toEqual({ nom: 'Me Gagnon', contact: 'gagnon@etude.ca', profession: 'notaire' });

    const fiche = valeur(client);
    expect(fiche.nom).toBe('Camille Fortin');
    expect(fiche.telephone).toBe('450 555-7777');
  });

  it('crée la fiche client sans adresse, et le dit dans les notes', () => {
    const fiche = valeur(depuisPartenaire(PARTENAIRE).client);
    expect(fiche.courriel).toBe('');
    expect(fiche.notes).toContain('Me Gagnon');
    expect(fiche.notes).toContain('portail restera fermé');
  });

  it('n’invente pas de référent quand le professionnel n’est pas nommé', () => {
    const { referent } = depuisPartenaire({ ...PARTENAIRE, 'nom-partenaire': '' });
    expect(referent).toBeNull();
  });

  it('refuse une référence sans aucun moyen de joindre le client', () => {
    const { client } = depuisPartenaire({ ...PARTENAIRE, 'client-telephone': '' });
    expect(client.ok).toBe(false);
  });
});

describe('robustesse', () => {
  it('refuse une charge utile qui n’est pas un objet', () => {
    for (const adaptateur of [depuisRappel, depuisContact, depuisRefinancement, depuisOutils]) {
      expect(adaptateur(null).ok).toBe(false);
      expect(adaptateur('texte').ok).toBe(false);
    }
  });

  it('refuse une fiche sans nom exploitable', () => {
    expect(depuisRappel({ ...RAPPEL, nom: '' }).ok).toBe(false);
  });

  it('accepte une fiche sans courriel dès qu’un téléphone existe', () => {
    const fiche = valeur(depuisRappel({ ...RAPPEL, courriel: '' }));
    expect(fiche.courriel).toBe('');
    expect(fiche.telephone).toBe('450 555-1234');
  });
});
