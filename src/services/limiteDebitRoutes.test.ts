/**
 * Verrou : où la limite de débit par IP s'applique, et où elle ne doit pas s'appliquer.
 *
 * Une route gardée par la session de la courtière (`requeteAutorisee`) n'est pas limitée par
 * IP : le mot de passe la protège déjà, et un plafond de 5 par heure bloquait Stéphanie dès
 * son sixième contrat créé, relancé ou corrigé de l'heure. La seule porte qui doit rester
 * limitée est celle qui reçoit le mot de passe — sans quoi il serait devinable à la force brute.
 *
 * Placé ici et non à côté des routes : tout fichier `.ts` sous src/pages/ devient un endpoint.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOSSIER = new URL('../pages/api/', import.meta.url);
const routes = readdirSync(DOSSIER)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ nom: f, source: readFileSync(new URL(f, DOSSIER), 'utf8') }));

describe('limite de débit des routes', () => {
  it('ne limite par IP aucune route gardée par la session de la courtière', () => {
    const gardees = routes.filter((r) => r.source.includes('requeteAutorisee('));
    expect(gardees.length).toBeGreaterThan(5);
    expect(gardees.filter((r) => r.source.includes('checkRateLimit(')).map((r) => r.nom)).toEqual([]);
  });

  it('garde le plafond par défaut sur la porte du mot de passe', () => {
    const acces = routes.find((r) => r.nom === 'contrat-acces.ts')!;
    expect(acces.source).toMatch(/checkRateLimit\(ip, 'contrat-acces'\)/);
  });
});
