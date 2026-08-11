import { describe, expect, it } from 'vitest';
import {
  AUTRE_MONTANT_MAX,
  MAX_SIGNATAIRES,
  QUESTIONS,
  QUESTIONS_PAR_ID,
  SIGNATURE_POIDS_MAX,
  TRACE_HAUTEUR_MAX,
  ZONES_SIGNATURE,
  decoderTraceSignature,
  libelleReponse,
  parserReponses,
  parserSignataires,
  resumerReponses,
} from './profilEmprunteurs';

/** Jeu de réponses valide minimal, réutilisé par les cas de test. */
function reponsesValides(surcharge: Record<string, unknown> = {}) {
  return {
    experience: 'moyen',
    connaissances: 'reduites',
    absorption: '250',
    remboursement: 'faibles',
    apports: 'moyennes',
    besoins: 'tres_faibles',
    virtuel: 'bon',
    priorite: 'moins_interet',
    ...surcharge,
  };
}

/**
 * Fabrique un PNG minimal valide. Seuls l'entête et le chunk IHDR comptent pour
 * `decoderTraceSignature` — le reste des octets n'est jamais interprété par cette fonction.
 */
function pngFactice(largeur: number, hauteur: number, octetsSupplementaires = 0): string {
  const taille = 24 + octetsSupplementaires;
  const octets = new Uint8Array(taille);
  octets.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const vue = new DataView(octets.buffer);
  vue.setUint32(8, 13); // longueur du chunk IHDR
  octets.set([0x49, 0x48, 0x44, 0x52], 12); // « IHDR »
  vue.setUint32(16, largeur);
  vue.setUint32(20, hauteur);

  let binaire = '';
  for (const octet of octets) binaire += String.fromCharCode(octet);
  return `data:image/png;base64,${btoa(binaire)}`;
}

describe('catalogue du formulaire', () => {
  it('couvre les 8 questions du modèle', () => {
    expect(QUESTIONS).toHaveLength(8);
  });

  it('décrit exactement les 30 cases à cocher du modèle', () => {
    const total = QUESTIONS.reduce((somme, q) => somme + q.options.length, 0);
    expect(total).toBe(30);
  });

  it('n’attribue jamais deux options à la même case', () => {
    const positions = QUESTIONS.flatMap((q) => q.options.map((o) => `${o.caseAcocher[0]}:${o.caseAcocher[1]}`));
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('garde les cases dans les limites de la page US Letter', () => {
    for (const question of QUESTIONS) {
      for (const option of question.options) {
        const [x, y] = option.caseAcocher;
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(612);
        // Les cases vivent entre les lignes de signature (y ≈ 96) et le préambule (y ≈ 527).
        expect(y).toBeGreaterThan(96);
        expect(y).toBeLessThan(527);
      }
    }
  });

  it('n’utilise pas deux fois la même clé dans une question', () => {
    for (const question of QUESTIONS) {
      const cles = question.options.map((o) => o.cle);
      expect(new Set(cles).size).toBe(cles.length);
    }
  });

  it('indexe chaque question par son identifiant', () => {
    for (const question of QUESTIONS) {
      expect(QUESTIONS_PAR_ID[question.id]).toBe(question);
    }
  });

  it('prévoit une zone de signature par emprunteur possible', () => {
    expect(ZONES_SIGNATURE).toHaveLength(MAX_SIGNATAIRES);
    // Les lignes descendent : chaque zone est sous la précédente, sans chevauchement.
    for (let i = 1; i < ZONES_SIGNATURE.length; i += 1) {
      const ecart = ZONES_SIGNATURE[i - 1]!.trace[1] - ZONES_SIGNATURE[i]!.trace[1];
      expect(ecart).toBeGreaterThanOrEqual(TRACE_HAUTEUR_MAX);
    }
  });
});

describe('parserReponses', () => {
  it('accepte un jeu de réponses complet', () => {
    const resultat = parserReponses(reponsesValides());
    expect(resultat).not.toBeNull();
    expect(resultat!.choix.priorite).toBe('moins_interet');
    expect(resultat!.autreMontant).toBeNull();
  });

  it('refuse une clé inconnue', () => {
    expect(parserReponses(reponsesValides({ virtuel: 'parfait' }))).toBeNull();
  });

  it('refuse une question manquante', () => {
    const partiel = reponsesValides();
    delete (partiel as Record<string, unknown>).besoins;
    expect(parserReponses(partiel)).toBeNull();
  });

  it('refuse une valeur d’un autre type', () => {
    expect(parserReponses(reponsesValides({ experience: 42 }))).toBeNull();
    expect(parserReponses(null)).toBeNull();
    expect(parserReponses('moyen')).toBeNull();
  });

  it('exige un montant quand « Autre » est choisi', () => {
    expect(parserReponses(reponsesValides({ absorption: 'autre' }))).toBeNull();
    const resultat = parserReponses(reponsesValides({ absorption: 'autre', autre_montant: 325 }));
    expect(resultat!.autreMontant).toBe(325);
  });

  it('accepte un montant transmis en chaîne avec des espaces', () => {
    const resultat = parserReponses(reponsesValides({ absorption: 'autre', autre_montant: '1 250' }));
    expect(resultat!.autreMontant).toBe(1250);
  });

  it('refuse un montant hors bornes, décimal ou négatif', () => {
    for (const montant of [0, -50, 12.5, AUTRE_MONTANT_MAX + 1]) {
      expect(parserReponses(reponsesValides({ absorption: 'autre', autre_montant: montant }))).toBeNull();
    }
  });

  it('refuse un montant envoyé sans avoir choisi « Autre »', () => {
    expect(parserReponses(reponsesValides({ absorption: '250', autre_montant: 300 }))).toBeNull();
  });

  it('tolère un montant vide quand « Autre » n’est pas choisi', () => {
    expect(parserReponses(reponsesValides({ autre_montant: '' }))).not.toBeNull();
  });
});

describe('libelleReponse et resumerReponses', () => {
  it('rend le montant saisi plutôt que « Autre montant »', () => {
    expect(libelleReponse('absorption', 'autre', 325)).toBe('325 $');
  });

  it('rend le libellé exact du formulaire pour les autres options', () => {
    expect(libelleReponse('priorite', 'vite')).toBe('Rembourser le plus vite possible');
  });

  it('reste neutre devant une clé inconnue', () => {
    expect(libelleReponse('virtuel', 'inexistant')).toBe('—');
  });

  it('résume les 8 questions dans l’ordre du formulaire', () => {
    const resume = resumerReponses(parserReponses(reponsesValides())!);
    expect(resume).toHaveLength(8);
    expect(resume[0]![0]).toContain('niveau d’expérience');
    expect(resume[7]![1]).toBe('Payer le moins d’intérêt possible');
  });
});

describe('parserSignataires', () => {
  const marc = { nom: 'Marc-André Lacroix', courriel: 'marc@exemple.ca' };
  const julie = { nom: 'Julie Bergeron', courriel: 'julie@exemple.ca' };

  it('accepte de 1 à 3 signataires', () => {
    expect(parserSignataires([marc])).toHaveLength(1);
    expect(parserSignataires([marc, julie])).toHaveLength(2);
  });

  it('refuse une liste vide ou trop longue', () => {
    expect(parserSignataires([])).toBeNull();
    expect(parserSignataires([marc, julie, { ...marc, courriel: 'a@b.ca' }, { ...julie, courriel: 'c@d.ca' }])).toBeNull();
  });

  it('refuse deux signataires qui partagent une adresse', () => {
    expect(parserSignataires([marc, { ...julie, courriel: marc.courriel }])).toBeNull();
  });

  it('ignore la casse en comparant les adresses', () => {
    expect(parserSignataires([marc, { ...julie, courriel: 'MARC@EXEMPLE.CA' }])).toBeNull();
  });

  it('refuse un nom trop court et un courriel malformé', () => {
    expect(parserSignataires([{ ...marc, nom: 'M' }])).toBeNull();
    expect(parserSignataires([{ ...marc, courriel: 'marc@exemple' }])).toBeNull();
  });

  it('normalise les adresses en minuscules', () => {
    expect(parserSignataires([{ ...marc, courriel: 'Marc@Exemple.CA' }])![0]!.courriel).toBe('marc@exemple.ca');
  });
});

describe('decoderTraceSignature', () => {
  it('accepte un PNG plausible', () => {
    expect(decoderTraceSignature(pngFactice(600, 200))).toBeInstanceOf(Uint8Array);
  });

  it('refuse tout ce qui n’est pas une data URL PNG', () => {
    expect(decoderTraceSignature('data:image/jpeg;base64,AAAA')).toBeNull();
    expect(decoderTraceSignature('https://exemple.ca/signature.png')).toBeNull();
    expect(decoderTraceSignature('')).toBeNull();
    expect(decoderTraceSignature(undefined)).toBeNull();
  });

  it('refuse un PNG dont l’entête est falsifiée', () => {
    const truque = pngFactice(600, 200).replace('data:image/png;base64,', '');
    const decode = atob(truque);
    const octets = new Uint8Array(decode.length);
    for (let i = 0; i < decode.length; i += 1) octets[i] = decode.charCodeAt(i);
    octets[1] = 0x00; // casse le nombre magique
    let binaire = '';
    for (const octet of octets) binaire += String.fromCharCode(octet);
    expect(decoderTraceSignature(`data:image/png;base64,${btoa(binaire)}`)).toBeNull();
  });

  it('refuse des dimensions aberrantes', () => {
    expect(decoderTraceSignature(pngFactice(4000, 200))).toBeNull();
    expect(decoderTraceSignature(pngFactice(600, 1200))).toBeNull();
    expect(decoderTraceSignature(pngFactice(2, 2))).toBeNull();
  });

  it('refuse une image trop lourde', () => {
    expect(decoderTraceSignature(pngFactice(600, 200, SIGNATURE_POIDS_MAX))).toBeNull();
  });
});
