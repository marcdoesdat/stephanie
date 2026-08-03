import { describe, it, expect } from 'vitest';
import { extractAllRates, rowsToFlat, rateCacheControl, type HypothecaRates } from './ratesService';

/**
 * Encode comme `occ()` sur hypotheca.ca : ROT13 sur les lettres, ROT5 sur les
 * chiffres. Les deux transformations sont involutives, donc encoder revient à
 * appliquer le décodeur.
 */
function encodeOcc(str: string): string {
  return str
    .replace(/[a-z]/gi, (char) => {
      const code = char.charCodeAt(0);
      return String.fromCharCode(code + ((95 & code) > 77 ? -13 : 13));
    })
    .replace(/\d/g, (d) => {
      const val = parseInt(d, 10);
      return (val > 4 ? val - 5 : val + 5).toString();
    });
}

describe('extractAllRates — tableau HTML', () => {
  it('parse un tableau simple à trois colonnes', () => {
    const html = `
      <table>
        <tr><th>Terme</th><th>Votre taux</th><th>Taux affiché</th></tr>
        <tr><td>5 ans variable</td><td>4.20%</td><td>5.95%</td></tr>
        <tr><td>5 ans fixe</td><td>4.19%</td><td>6.49%</td></tr>
      </table>`;

    const rows = extractAllRates(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ terme: '5 ans variable', hypotheca: 4.2, affiche: 5.95, type: 'variable', populaire: true });
    expect(rows[1]).toMatchObject({ terme: '5 ans fixe', hypotheca: 4.19, affiche: 6.49, type: 'fixe' });
  });

  it('tolère des balises imbriquées dans les cellules', () => {
    const html = `
      <tr class="row"><td><span class="lbl">3 ans fixe</span></td>
      <td><strong>4,09&nbsp;%</strong></td><td><em>5,79&nbsp;%</em></td></tr>`;

    const rows = extractAllRates(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ terme: '3 ans fixe', hypotheca: 4.09, affiche: 5.79 });
  });

  it('tolère une colonne supplémentaire et un <th scope="row">', () => {
    const html = `
      <tr><th scope="row">2 ans fixe</th><td>4.59 %</td><td>6.09 %</td><td><a href="/x">Détails</a></td></tr>`;

    const rows = extractAllRates(html);
    expect(rows[0]).toMatchObject({ terme: '2 ans fixe', hypotheca: 4.59, affiche: 6.09 });
  });

  it('ne confond pas le libellé du terme avec un taux', () => {
    // « 5 ans » vaudrait 5.00 si on parsait la première cellule comme un nombre.
    const html = `<tr><td>5 ans</td><td>4.19 %</td></tr>`;
    const rows = extractAllRates(html);
    expect(rows[0]?.hypotheca).toBe(4.19);
    expect(rows[0]?.affiche).toBeNull();
  });

  it('ignore les en-têtes, les lignes de notes et les taux hors bornes', () => {
    const html = `
      <tr><td>Terme</td><td>Votre taux</td><td>Taux affiché</td></tr>
      <tr><td>Certaines conditions s'appliquent</td><td>—</td><td>—</td></tr>
      <tr><td>1 an fixe</td><td>0.10 %</td><td>5.99 %</td></tr>
      <tr><td>4 ans fixe</td><td>4.29 %</td><td>6.19 %</td></tr>`;

    const rows = extractAllRates(html);
    expect(rows.map((r) => r.terme)).toEqual(['4 ans fixe']);
  });

  it('écarte la ligne plutôt que de décaler le taux affiché dans « votre taux »', () => {
    // Si la 1re valeur est aberrante, la garder décalée afficherait le taux
    // des grandes banques comme étant celui obtenu via le réseau Hypotheca.
    const rows = extractAllRates('<tr><td>1 an fixe</td><td>0.10 %</td><td>5.99 %</td></tr>');
    expect(rows).toEqual([]);
  });

  it('déduplique les termes en gardant la première occurrence', () => {
    const html = `
      <tr><td>5 ans fixe</td><td>4.19 %</td><td>6.49 %</td></tr>
      <tr><td>5 ans fixe</td><td>9.99 %</td><td>9.99 %</td></tr>`;

    const rows = extractAllRates(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hypotheca).toBe(4.19);
  });

  it('retourne un tableau vide sur une page sans taux', () => {
    expect(extractAllRates('<html><body><h1>Accès refusé</h1></body></html>')).toEqual([]);
  });
});

describe('extractAllRates — occ() et markdown', () => {
  it('décode les lignes obfusquées quand le tableau visible est absent', () => {
    const html = `<script>document.write(occ("${encodeOcc('<tr><td>5 ans fixe</td><td>4.19 %</td><td>6.49 %</td></tr>')}"));</script>`;

    const rows = extractAllRates(html);
    expect(rows[0]).toMatchObject({ terme: '5 ans fixe', hypotheca: 4.19, affiche: 6.49 });
  });

  it('complète le tableau visible avec les lignes obfusquées', () => {
    const html = `
      <tr><td>5 ans fixe</td><td>4.19 %</td><td>6.49 %</td></tr>
      <script>occ("${encodeOcc('<td>10 ans fixe</td><td>5.49 %</td><td>7.10 %</td>')}")</script>`;

    const rows = extractAllRates(html);
    expect(rows.map((r) => r.terme)).toEqual(['5 ans fixe', '10 ans fixe']);
  });

  it('parse un tableau markdown (format proxy)', () => {
    const md = [
      '| Terme | Votre taux | Taux affiché |',
      '| --- | --- | --- |',
      '| 5 ans variable | 4,20 % | 5,95 % |',
      '| 5 ans fixe | 4,19 % | 6,49 % |',
    ].join('\n');

    const rows = extractAllRates(md);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ terme: '5 ans fixe', hypotheca: 4.19, affiche: 6.49 });
  });
});

describe('rowsToFlat', () => {
  it('mappe tous les termes suivis', () => {
    const rows = extractAllRates(`
      <tr><td>5 ans variable</td><td>4.20 %</td><td>5.95 %</td></tr>
      <tr><td>1 an fixe</td><td>5.49 %</td><td>6.99 %</td></tr>
      <tr><td>2 ans fixe</td><td>4.59 %</td><td>6.09 %</td></tr>
      <tr><td>3 ans fixe</td><td>4.09 %</td><td>5.79 %</td></tr>
      <tr><td>4 ans fixe</td><td>4.29 %</td><td>6.19 %</td></tr>
      <tr><td>5 ans fixe</td><td>4.19 %</td><td>6.49 %</td></tr>
      <tr><td>7 ans fixe</td><td>5.09 %</td><td>6.85 %</td></tr>
      <tr><td>10 ans fixe</td><td>5.49 %</td><td>7.10 %</td></tr>`);

    expect(rowsToFlat(rows)).toMatchObject({
      variable: 4.2,
      affiche_variable: 5.95,
      fixe_1ans: 5.49,
      fixe_2ans: 4.59,
      fixe_3ans: 4.09,
      fixe_4ans: 4.29,
      fixe_5ans: 4.19,
      affiche_fixe_5ans: 6.49,
      fixe_7ans: 5.09,
      fixe_10ans: 5.49,
    });
  });

  it('mappe un « 5 ans » sans le mot « fixe »', () => {
    // Régression : l'ancienne implémentation exigeait « fixe » dans le libellé
    // uniquement pour le 5 ans, qui restait donc null si Hypotheca le renommait.
    const flat = rowsToFlat(extractAllRates('<tr><td>5 ans</td><td>4.19 %</td><td>6.49 %</td></tr>'));
    expect(flat.fixe_5ans).toBe(4.19);
    expect(flat.affiche_fixe_5ans).toBe(6.49);
  });

  it('classe « 5 ans variable » comme variable et non comme fixe 5 ans', () => {
    const flat = rowsToFlat(extractAllRates('<tr><td>5 ans variable</td><td>4.20 %</td><td>5.95 %</td></tr>'));
    expect(flat.variable).toBe(4.2);
    expect(flat.fixe_5ans).toBeUndefined();
  });

  it('ignore les termes non suivis', () => {
    expect(rowsToFlat(extractAllRates('<tr><td>15 ans fixe</td><td>6.10 %</td><td>7.50 %</td></tr>'))).toEqual({});
  });
});

describe('rateCacheControl', () => {
  it('met en cache 6 h quand les taux sont présents', () => {
    const rates = { rows: [] } as unknown as HypothecaRates;
    expect(rateCacheControl(rates)).toContain('s-maxage=21600');
  });

  it('réduit fortement le cache CDN quand les taux manquent', () => {
    expect(rateCacheControl(null)).toBe('s-maxage=120, stale-while-revalidate=120');
  });
});
