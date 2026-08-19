/**
 * Tests du cockpit : ce qui remonte, ce qui n'y remonte jamais, et dans quel ordre.
 *
 * Le tableau de bord est la première chose que Stéphanie ouvrira le matin, et la seule
 * qu'elle lira si la journée est chargée. Les garanties qui comptent :
 *
 * 1. **Un contact retiré ou déjà partenaire ne remonte jamais.** Le premier a demandé
 *    qu'on le laisse — l'exclure à l'affichage seulement rendrait l'oubli facile.
 * 2. **Le carnet d'origine ne pèse rien dans le tri.** C'est le sens de l'écran : un
 *    contrat refusé passe devant une relance, quelle que soit sa provenance.
 * 3. **Un dossier clos ne remonte jamais** — garanti par `dossiersEcran`, revérifié ici à
 *    travers la fusion, parce que c'est la fusion qui s'affiche.
 * 4. **Un carnet absent n'est pas une erreur** : si `/api/reseau-contacts` n'a pas répondu,
 *    les deux autres doivent quand même s'afficher.
 */
import { describe, expect, it } from 'vitest';
import {
  motifUrgenceContrat,
  motifUrgenceReseau,
  phraseUrgenceContrat,
  phraseUrgenceReseau,
  tachesDuJour,
  urgencesContrats,
  urgencesReseau,
  type ContactEcran,
  type ResumeEcran,
} from './tableauDeBord';
import type { CleEtape, CleEtatDocument } from './dossiersClients';
import type { CleEtat } from './reseauCourtiers';

const MAINTENANT = Date.parse('2026-05-14T12:00:00.000Z');
const JOUR = 86_400_000;
const OPTIONS = { delaiSansMouvementJours: 7, delaiSansReponseJours: 10, maintenant: MAINTENANT };

function iso(joursAvant: number): string {
  return new Date(MAINTENANT - joursAvant * JOUR).toISOString();
}

function contact(options: Partial<{
  id: string;
  nom: string;
  etat: CleEtat;
  relanceIlYA: number | null;
  envoiIlYA: number | null;
}> = {}): ContactEcran {
  const {
    id = 'c1',
    nom = 'Julie Bertrand',
    etat = 'contacte',
    relanceIlYA = null,
    envoiIlYA = null,
  } = options;
  return {
    id,
    nom,
    etat,
    relanceLe: relanceIlYA === null ? null : iso(relanceIlYA),
    dernierEnvoiLe: envoiIlYA === null ? null : iso(envoiIlYA),
  };
}

function resume(options: Partial<{
  id: string;
  statut: ResumeEcran['statut'];
  expireDansJours: number;
  noms: string[];
  courant: string | null;
  refusePar: string | null;
}> = {}): ResumeEcran {
  const {
    id = 'k1',
    statut = 'en_attente',
    expireDansJours = 9,
    noms = ['Marc Auclair'],
    courant = null,
    refusePar = null,
  } = options;
  return {
    id,
    statut,
    expireLe: new Date(MAINTENANT + expireDansJours * JOUR).toISOString(),
    emprunteurs: noms.map((nom) => ({ nom })),
    courant: courant === null ? null : { nom: courant },
    refusePar,
  };
}

function dossier(options: Partial<{
  id: string;
  nom: string;
  etape: CleEtape;
  majIlYA: number;
  relanceIlYA: number | null;
  documents: CleEtatDocument[];
}> = {}) {
  const {
    id = 'd1',
    nom = 'Marie Tremblay',
    etape = 'nouveau',
    majIlYA = 0,
    relanceIlYA = null,
    documents = [],
  } = options;
  return {
    id,
    nom,
    etape,
    majLe: iso(majIlYA),
    relanceLe: relanceIlYA === null ? null : iso(relanceIlYA),
    documents: documents.map((etat) => ({ etat })),
  };
}

/* ------------------------------------------------------------------ */

describe('motifUrgenceReseau', () => {
  it('ne remonte jamais un contact retiré, même avec une relance en retard', () => {
    expect(motifUrgenceReseau(contact({ etat: 'refuse', relanceIlYA: 30 }), OPTIONS)).toBeNull();
  });

  it('ne remonte jamais un partenaire acquis : il n’attend rien', () => {
    expect(motifUrgenceReseau(contact({ etat: 'partenaire', relanceIlYA: 5 }), OPTIONS)).toBeNull();
  });

  it('remonte une relance fixée à aujourd’hui, sans attendre le lendemain', () => {
    expect(motifUrgenceReseau(contact({ relanceIlYA: 0 }), OPTIONS)).toEqual({
      type: 'relance',
      joursDeRetard: 0,
    });
  });

  it('ignore une relance encore à venir', () => {
    expect(motifUrgenceReseau(contact({ relanceIlYA: -3 }), OPTIONS)).toBeNull();
  });

  it('remonte un contact approché resté muet au-delà du délai', () => {
    expect(motifUrgenceReseau(contact({ etat: 'relance', envoiIlYA: 12 }), OPTIONS)).toEqual({
      type: 'sans_reponse',
      jours: 12,
    });
  });

  it('laisse dormir un contact approché depuis moins que le délai', () => {
    expect(motifUrgenceReseau(contact({ etat: 'contacte', envoiIlYA: 4 }), OPTIONS)).toBeNull();
  });

  it('ne réclame rien d’un contact jamais approché : il attend un premier geste, pas une relance', () => {
    expect(motifUrgenceReseau(contact({ etat: 'a_contacter' }), OPTIONS)).toBeNull();
  });

  it('fait passer la relance devant le silence', () => {
    const liste = urgencesReseau(
      [contact({ id: 'muet', etat: 'contacte', envoiIlYA: 40 }), contact({ id: 'du', relanceIlYA: 1 })],
      OPTIONS,
    );
    expect(liste.map((e) => e.contact.id)).toEqual(['du', 'muet']);
  });
});

describe('motifUrgenceContrat', () => {
  it('signale un refus avant tout le reste', () => {
    expect(motifUrgenceContrat(resume({ statut: 'gele', refusePar: 'Luc Roy' }), OPTIONS)).toEqual({
      type: 'refuse',
      par: 'Luc Roy',
    });
  });

  it('signale un dossier qui n’attend plus que sa signature', () => {
    expect(motifUrgenceContrat(resume({ statut: 'a_finaliser' }), OPTIONS)).toEqual({
      type: 'a_finaliser',
    });
  });

  it('laisse tranquille un dossier en attente dont le lien vaut encore des jours', () => {
    expect(motifUrgenceContrat(resume({ expireDansJours: 8 }), OPTIONS)).toBeNull();
  });

  it('réclame la réémission d’un lien qui touche à sa fin', () => {
    const motif = motifUrgenceContrat(resume({ expireDansJours: 1 }), OPTIONS);
    expect(motif).toEqual({ type: 'bientot_perime', heuresRestantes: 24 });
  });

  it('trie le refus devant la finalisation, et la finalisation devant l’expiration', () => {
    const liste = urgencesContrats(
      [
        resume({ id: 'perime', expireDansJours: 0.5 }),
        resume({ id: 'refuse', statut: 'gele' }),
        resume({ id: 'finaliser', statut: 'a_finaliser' }),
      ],
      OPTIONS,
    );
    expect(liste.map((e) => e.resume.id)).toEqual(['refuse', 'finaliser', 'perime']);
  });
});

describe('les phrases', () => {
  it('distingue une relance du jour d’une relance en retard', () => {
    expect(phraseUrgenceReseau({ type: 'relance', joursDeRetard: 0 })).toBe(
      'Relance prévue aujourd’hui',
    );
    expect(phraseUrgenceReseau({ type: 'relance', joursDeRetard: 1 })).toBe(
      'Relance prévue il y a 1 jour',
    );
    expect(phraseUrgenceReseau({ type: 'relance', joursDeRetard: 4 })).toBe(
      'Relance prévue il y a 4 jours',
    );
  });

  it('nomme celui qui a refusé, quand on le sait', () => {
    expect(phraseUrgenceContrat({ type: 'refuse', par: 'Luc Roy' })).toBe(
      'Contrat refusé par Luc Roy',
    );
    expect(phraseUrgenceContrat({ type: 'refuse', par: null })).toBe('Contrat refusé');
  });
});

describe('tachesDuJour', () => {
  it('mêle les trois carnets et trie par urgence, pas par provenance', () => {
    const taches = tachesDuJour(
      {
        dossiers: [
          dossier({ id: 'dort', etape: 'contact', majIlYA: 20 }),
          dossier({ id: 'relance', relanceIlYA: 2 }),
        ],
        contacts: [contact({ id: 'muet', etat: 'contacte', envoiIlYA: 15 })],
        contrats: [resume({ id: 'refuse', statut: 'gele', refusePar: 'Luc Roy' })],
      },
      OPTIONS,
    );

    // À poids égal, le plus en retard passe devant : le dossier immobile depuis 20 jours
    // devance le contact muet depuis 15, bien qu'ils viennent de carnets différents.
    expect(taches.map((t) => t.id)).toEqual(['refuse', 'relance', 'dort', 'muet']);
    expect(taches.map((t) => t.carnet)).toEqual(['contrat', 'dossier', 'dossier', 'reseau']);
  });

  it('donne à chaque tâche un lien qui ouvre la bonne fiche', () => {
    const taches = tachesDuJour(
      {
        dossiers: [dossier({ id: 'd 1', relanceIlYA: 1 })],
        contacts: [contact({ id: 'c1', relanceIlYA: 1 })],
        contrats: [resume({ id: 'k1', statut: 'a_finaliser' })],
      },
      OPTIONS,
    );
    const liens = Object.fromEntries(taches.map((t) => [t.carnet, t.lien]));
    expect(liens.dossier).toBe('/dossiers#f=d%201');
    expect(liens.reseau).toBe('/reseau#f=c1');
    expect(liens.contrat).toBe('/contrat#ct-suivi');
  });

  it('n’exige aucun carnet : celui qui n’a pas répondu n’efface pas les autres', () => {
    const taches = tachesDuJour({ contrats: [resume({ statut: 'a_finaliser' })] }, OPTIONS);
    expect(taches).toHaveLength(1);
    expect(taches[0]?.carnet).toBe('contrat');
  });

  it('ne remonte jamais un dossier clos, même porteur d’une relance oubliée', () => {
    const taches = tachesDuJour(
      { dossiers: [dossier({ etape: 'finance', relanceIlYA: 30, majIlYA: 90 })] },
      OPTIONS,
    );
    expect(taches).toEqual([]);
  });

  it('reste vide quand rien ne presse', () => {
    const taches = tachesDuJour(
      {
        dossiers: [dossier({ majIlYA: 1 })],
        contacts: [contact({ etat: 'a_contacter' })],
        contrats: [resume({ expireDansJours: 9 })],
      },
      OPTIONS,
    );
    expect(taches).toEqual([]);
  });

  it('nomme le contrat par ses emprunteurs quand personne n’est en cause', () => {
    const taches = tachesDuJour(
      { contrats: [resume({ statut: 'a_finaliser', noms: ['Marc Auclair', 'Ana Pires'] })] },
      OPTIONS,
    );
    expect(taches[0]?.nom).toBe('Marc Auclair, Ana Pires');
  });
});
