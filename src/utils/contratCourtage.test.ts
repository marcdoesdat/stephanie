/**
 * Tests du catalogue et de la validation du contrat de courtage.
 *
 * Deux choses à protéger ici :
 *
 *  1. **La géométrie.** Les coordonnées sont extraites du modèle PDF d'Hypotheca. Une
 *     coquille (page 3 au lieu de 2, un y négatif) produit un contrat d'apparence normale
 *     dont une valeur est posée au mauvais endroit — le genre d'erreur qu'aucune exception
 *     ne signale et qu'on ne voit qu'en ouvrant le document.
 *
 *  2. **La whitelist.** Rien de ce que le navigateur envoie n'est repris tel quel. Le
 *     catalogue fait office de liste blanche : toute case ou option inconnue doit faire
 *     échouer la validation, pas se retrouver dans le PDF.
 */
import { describe, expect, it } from 'vitest';
import {
  ADRESSE_PROJET,
  AUTRES_EXIGENCES,
  COLONNES_IDENTITE,
  COURTIER,
  DOUBLE_REMUNERATION,
  EMPRUNTEURS,
  INITIALES_COLLABORATEUR,
  INITIALES_RESILIATION,
  INITIALES_RETRIBUTION,
  LIGNES_IDENTITE,
  MAX_EMPRUNTEURS,
  PAGE_HAUTEUR,
  PAGE_LARGEUR,
  PPV_CASES,
  RAISON_DOUBLE_REMUNERATION,
  TRANSFERT_CABINET_CASES,
  TYPES_FINANCEMENT,
  TYPES_TAUX,
  ZONES_SIGNATURE_EMPRUNTEURS,
  ZONE_SIGNATURE_COURTIER,
  estCourrielValide,
  initialesDe,
  nomComplet,
  parserDonneesContrat,
  parserEmprunteurs,
  repartirSurLignes,
  resumerContrat,
  type Emplacement,
} from './contratCourtage';

/** Le minimum qu'accepte `parserDonneesContrat`. */
const MINIMAL = {
  emprunteurs: [{ prenom: 'Ana', nom: 'Silva', courriel: 'ana@exemple.ca' }],
  ppv: 'non',
  transfertCabinet: 'non',
  typesFinancement: [],
};

/* ------------------------------------------------------------------ */
/*  Géométrie                                                          */
/* ------------------------------------------------------------------ */

describe('géométrie du modèle', () => {
  /** Tous les emplacements de texte du catalogue, à plat. */
  const emplacements: Emplacement[] = [
    ...Object.values(COURTIER),
    ...EMPRUNTEURS.flatMap((e) => [e.prenom, e.nom, e.telephone, e.adresse, e.courriel]),
    ADRESSE_PROJET,
    ...AUTRES_EXIGENCES,
    ...RAISON_DOUBLE_REMUNERATION,
    ...INITIALES_COLLABORATEUR,
    ...INITIALES_RETRIBUTION,
    ...INITIALES_RESILIATION,
  ];

  it('place chaque champ dans les limites de la page', () => {
    for (const emplacement of emplacements) {
      const [x, y] = emplacement.point;
      expect(emplacement.page).toBeGreaterThanOrEqual(1);
      expect(emplacement.page).toBeLessThanOrEqual(4);
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(PAGE_HAUTEUR);
      // Un champ qui commence après sa propre largeur sortirait de la feuille.
      expect(x + emplacement.largeur).toBeLessThanOrEqual(PAGE_LARGEUR);
    }
  });

  it('donne à chaque champ une largeur utile', () => {
    for (const emplacement of emplacements) {
      expect(emplacement.largeur).toBeGreaterThan(20);
    }
  });

  it('place chaque case à cocher dans les limites de la page', () => {
    const cases = [
      ...Object.values(PPV_CASES),
      ...Object.values(TRANSFERT_CABINET_CASES),
      ...TYPES_FINANCEMENT.map((t) => t.caseAcocher),
      ...TYPES_TAUX.map((t) => t.caseAcocher),
      ...DOUBLE_REMUNERATION.map((o) => o.caseAcocher),
    ];
    for (const c of cases) {
      expect(c.page).toBeGreaterThanOrEqual(1);
      expect(c.page).toBeLessThanOrEqual(4);
      expect(c.point[0]).toBeGreaterThan(0);
      expect(c.point[0]).toBeLessThan(PAGE_LARGEUR);
      expect(c.point[1]).toBeGreaterThan(0);
      expect(c.point[1]).toBeLessThan(PAGE_HAUTEUR);
    }
  });

  it('n’attribue jamais deux fois la même case à deux options', () => {
    const cles = TYPES_FINANCEMENT.map((t) => `${t.caseAcocher.page}:${t.caseAcocher.point.join(',')}`);
    expect(new Set(cles).size).toBe(TYPES_FINANCEMENT.length);
  });

  it('empile les trois lignes de signature de haut en bas sur la page 4', () => {
    const y = ZONES_SIGNATURE_EMPRUNTEURS.map((z) => z.trace[1]);
    expect(y).toEqual([...y].sort((a, b) => b - a));
    expect(ZONE_SIGNATURE_COURTIER.trace[1]).toBeGreaterThan(y[0]!);
    for (const zone of ZONES_SIGNATURE_EMPRUNTEURS) expect(zone.page).toBe(4);
  });

  it('aligne les blocs d’initiales sur le nombre d’emprunteurs', () => {
    for (const bloc of [INITIALES_COLLABORATEUR, INITIALES_RETRIBUTION, INITIALES_RESILIATION]) {
      expect(bloc).toHaveLength(MAX_EMPRUNTEURS);
    }
    expect(COLONNES_IDENTITE).toHaveLength(MAX_EMPRUNTEURS);
    expect(EMPRUNTEURS).toHaveLength(MAX_EMPRUNTEURS);
  });

  it('descend le tableau d’identité ligne après ligne', () => {
    const y = LIGNES_IDENTITE.map((l) => l.y);
    expect(y).toEqual([...y].sort((a, b) => b - a));
    expect(new Set(LIGNES_IDENTITE.map((l) => l.id)).size).toBe(LIGNES_IDENTITE.length);
  });
});

/* ------------------------------------------------------------------ */
/*  Emprunteurs                                                        */
/* ------------------------------------------------------------------ */

describe('parserEmprunteurs', () => {
  it('accepte de un à trois emprunteurs', () => {
    expect(parserEmprunteurs([{ prenom: 'Ana', nom: 'Silva', courriel: 'a@b.ca' }])).toHaveLength(1);
    expect(
      parserEmprunteurs([
        { prenom: 'Ana', nom: 'Silva', courriel: 'a@b.ca' },
        { prenom: 'Bo', nom: 'Tremblay', courriel: 'b@b.ca' },
        { prenom: 'Cam', nom: 'Roy', courriel: 'c@b.ca' },
      ]),
    ).toHaveLength(3);
  });

  it('refuse une liste vide ou de plus de trois', () => {
    expect(parserEmprunteurs([])).toBeNull();
    expect(
      parserEmprunteurs(
        Array.from({ length: 4 }, (_, i) => ({ prenom: 'Ana', nom: 'Silva', courriel: `a${i}@b.ca` })),
      ),
    ).toBeNull();
  });

  it('refuse deux emprunteurs qui partagent une adresse courriel', () => {
    // C'est tout ce que la chaîne de signature prouve : le contrôle d'une boîte distincte.
    expect(
      parserEmprunteurs([
        { prenom: 'Ana', nom: 'Silva', courriel: 'meme@exemple.ca' },
        { prenom: 'Bo', nom: 'Tremblay', courriel: 'MEME@exemple.ca' },
      ]),
    ).toBeNull();
  });

  it('refuse un courriel invalide ou un nom trop court', () => {
    expect(parserEmprunteurs([{ prenom: 'Ana', nom: 'Silva', courriel: 'pas-un-courriel' }])).toBeNull();
    expect(parserEmprunteurs([{ prenom: 'A', nom: 'Silva', courriel: 'a@b.ca' }])).toBeNull();
    expect(parserEmprunteurs([{ prenom: 'Ana', nom: '', courriel: 'a@b.ca' }])).toBeNull();
  });

  it('normalise la casse du courriel et les espaces', () => {
    const [emprunteur] = parserEmprunteurs([
      { prenom: '  Ana  ', nom: 'Silva ', courriel: '  ANA@Exemple.CA ' },
    ])!;
    expect(emprunteur).toMatchObject({ prenom: 'Ana', nom: 'Silva', courriel: 'ana@exemple.ca' });
  });

  it('refuse autre chose qu’un tableau', () => {
    expect(parserEmprunteurs(null)).toBeNull();
    expect(parserEmprunteurs('Ana')).toBeNull();
    expect(parserEmprunteurs([null])).toBeNull();
  });
});

describe('estCourrielValide', () => {
  it('accepte les formes courantes et refuse le reste', () => {
    expect(estCourrielValide('a.b+c@sous.domaine.ca')).toBe(true);
    expect(estCourrielValide('a@b')).toBe(false);
    expect(estCourrielValide('a b@c.ca')).toBe(false);
    expect(estCourrielValide(`${'a'.repeat(120)}@b.ca`)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Données du contrat                                                 */
/* ------------------------------------------------------------------ */

describe('parserDonneesContrat', () => {
  it('accepte un contrat minimal', () => {
    const donnees = parserDonneesContrat(MINIMAL);
    expect(donnees).not.toBeNull();
    expect(donnees!.typesFinancement).toEqual([]);
    expect(donnees!.typeTaux).toBeNull();
    expect(donnees!.doubleRemuneration).toBeNull();
  });

  it('refuse un type de financement inconnu', () => {
    expect(parserDonneesContrat({ ...MINIMAL, typesFinancement: ['achat_martien'] })).toBeNull();
  });

  it('accepte plusieurs types de financement et dédoublonne', () => {
    const donnees = parserDonneesContrat({
      ...MINIMAL,
      typesFinancement: ['refinancement', 'marge_credit', 'refinancement'],
    });
    expect(donnees!.typesFinancement).toEqual(['refinancement', 'marge_credit']);
  });

  it('refuse une valeur hors catalogue pour les champs à choix', () => {
    expect(parserDonneesContrat({ ...MINIMAL, ppv: 'peut-être' })).toBeNull();
    expect(parserDonneesContrat({ ...MINIMAL, transfertCabinet: 'oui-non' })).toBeNull();
    expect(parserDonneesContrat({ ...MINIMAL, typeTaux: 'hybride' })).toBeNull();
    expect(parserDonneesContrat({ ...MINIMAL, doubleRemuneration: 'peut-être' })).toBeNull();
  });

  it('traite une chaîne vide comme « non renseigné » pour les choix facultatifs', () => {
    const donnees = parserDonneesContrat({ ...MINIMAL, typeTaux: '', doubleRemuneration: '' });
    expect(donnees).not.toBeNull();
    expect(donnees!.typeTaux).toBeNull();
    expect(donnees!.doubleRemuneration).toBeNull();
  });

  it('exige ppv et transfertCabinet', () => {
    const { ppv, ...sansPpv } = MINIMAL;
    expect(parserDonneesContrat(sansPpv)).toBeNull();
    const { transfertCabinet, ...sansTransfert } = MINIMAL;
    expect(parserDonneesContrat(sansTransfert)).toBeNull();
  });

  it('refuse une charge qui n’est pas un objet', () => {
    expect(parserDonneesContrat(null)).toBeNull();
    expect(parserDonneesContrat('contrat')).toBeNull();
  });

  it('plafonne les champs libres au lieu de les laisser passer', () => {
    const donnees = parserDonneesContrat({ ...MINIMAL, preteurMajoritaire: 'X'.repeat(500) });
    expect(donnees!.preteurMajoritaire.length).toBeLessThanOrEqual(200);
  });

  it('écrase les retours à la ligne des champs d’une seule ligne', () => {
    const donnees = parserDonneesContrat({ ...MINIMAL, preteurMajoritaire: 'Banque\nNationale' });
    expect(donnees!.preteurMajoritaire).toBe('Banque Nationale');
  });

  it('conserve les retours à la ligne des champs multilignes', () => {
    const donnees = parserDonneesContrat({ ...MINIMAL, autresExigences: 'Ligne 1\n\nLigne 2' });
    expect(donnees!.autresExigences).toBe('Ligne 1\nLigne 2');
  });

  it('limite le tableau d’identité au nombre de colonnes du modèle', () => {
    const donnees = parserDonneesContrat({
      ...MINIMAL,
      identite: { document1: ['a', 'b', 'c', 'd'] },
    });
    expect(donnees!.identite.document1).toHaveLength(MAX_EMPRUNTEURS);
  });

  it('refuse un tableau d’identité mal formé', () => {
    expect(parserDonneesContrat({ ...MINIMAL, identite: { document1: 'permis' } })).toBeNull();
  });

  it('remplit toutes les lignes d’identité, même absentes de la saisie', () => {
    const donnees = parserDonneesContrat(MINIMAL);
    for (const ligne of LIGNES_IDENTITE) {
      expect(donnees!.identite[ligne.id]).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Utilitaires                                                        */
/* ------------------------------------------------------------------ */

describe('repartirSurLignes', () => {
  it('coupe au mot et respecte le nombre de lignes disponibles', () => {
    const lignes = repartirSurLignes('un deux trois quatre cinq six', 2, 10);
    expect(lignes).toHaveLength(2);
    for (const ligne of lignes) expect(ligne.length).toBeLessThanOrEqual(10);
  });

  it('respecte les retours à la ligne de la saisie', () => {
    expect(repartirSurLignes('abc\ndef', 4, 40)).toEqual(['abc', 'def']);
  });

  it('abandonne le surplus plutôt que de déborder du modèle', () => {
    const lignes = repartirSurLignes('a b c d e f g h i j k l', 2, 3);
    expect(lignes).toHaveLength(2);
  });

  it('ne coupe pas un mot plus long que la ligne — il déborderait de toute façon', () => {
    expect(repartirSurLignes('anticonstitutionnellement', 2, 5)).toEqual(['anticonstitutionnellement']);
  });

  it('ignore les lignes vides', () => {
    expect(repartirSurLignes('\n\n', 3, 10)).toEqual([]);
  });
});

describe('nomComplet et initialesDe', () => {
  it('assemble le nom et en tire les initiales', () => {
    const emprunteur = { prenom: 'Jonathan', nom: 'Poulin', telephone: '', adresse: '', courriel: 'a@b.ca' };
    expect(nomComplet(emprunteur)).toBe('Jonathan Poulin');
    expect(initialesDe(emprunteur)).toBe('JP');
  });

  it('met les initiales en majuscules', () => {
    expect(
      initialesDe({ prenom: 'valérie', nom: 'gignac', telephone: '', adresse: '', courriel: 'a@b.ca' }),
    ).toBe('VG');
  });
});

describe('resumerContrat', () => {
  it('nomme chaque emprunteur et rend les choix lisibles', () => {
    const donnees = parserDonneesContrat({
      ...MINIMAL,
      typesFinancement: ['refinancement'],
      tauxInteret: '4,29',
      typeTaux: 'fixe',
      ppv: 'oui',
    })!;
    const resume = resumerContrat(donnees);
    const table = new Map(resume);
    expect(table.get('Emprunteur 1')).toContain('Ana Silva');
    expect(table.get('Type de financement')).toBe('Refinancement');
    expect(table.get('Taux d’intérêt')).toBe('4,29 % (Fixe)');
    expect(table.get('Personne politiquement vulnérable')).toBe('Oui');
  });

  it('affiche un tiret plutôt qu’un vide sur les champs non remplis', () => {
    const table = new Map(resumerContrat(parserDonneesContrat(MINIMAL)!));
    expect(table.get('Montant du prêt')).toBe('—');
    expect(table.get('Type de financement')).toBe('—');
  });
});
