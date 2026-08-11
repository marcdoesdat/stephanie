/**
 * Bloc de signature — élément personnalisé `<signature-pad>`.
 *
 * Capture un tracé au doigt, au stylet ou à la souris et l'exporte en PNG à fond
 * transparent, recadré sur l'encre. Le recadrage compte autant que la capture : sans lui,
 * une signature occupe 20 % d'un grand canevas et se retrouve minuscule sur la ligne du
 * PDF, qui ne fait que 185 × 24 pt.
 *
 * Les traits sont conservés sous forme de points plutôt que de pixels. Cela permet de
 * redessiner proprement au redimensionnement, de mesurer la longueur du tracé (pour
 * refuser un point isolé) et de calculer la boîte englobante sans scruter le canal alpha.
 *
 * Un repli « signer en tapant son nom » est offert : dessiner est impossible pour
 * certaines personnes (motricité, lecteur d'écran). Le nom tapé est rendu sur un canevas
 * et ressort dans le même format PNG — le reste de la chaîne ne voit aucune différence.
 *
 * Utilisé par /profil-emprunteur et /signer.
 *
 * @module signaturePad
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Longueur cumulée minimale d'un tracé, en pixels CSS — écarte le point ou la barre. */
const LONGUEUR_MIN = 150;

/** Marge laissée autour de l'encre au recadrage. */
const MARGE = 8;

/** Plafonds alignés sur la validation serveur (`decoderTraceSignature`). */
const EXPORT_LARGEUR_MAX = 2000;
const EXPORT_HAUTEUR_MAX = 800;

const COULEUR = '#12206e';
const EPAISSEUR = 2.4;

export class SignaturePadElement extends HTMLElement {
  private canvas: HTMLCanvasElement | null = null;
  private contexte: CanvasRenderingContext2D | null = null;
  private champNom: HTMLInputElement | null = null;
  private traits: Point[][] = [];
  private traitCourant: Point[] | null = null;
  private modeTexte = false;
  private observateur: ResizeObserver | null = null;

  connectedCallback(): void {
    this.canvas = this.querySelector('canvas');
    this.champNom = this.querySelector('[data-sig-nom]');
    if (!this.canvas) return;
    this.contexte = this.canvas.getContext('2d');

    this.canvas.addEventListener('pointerdown', this.debuterTrait);
    this.canvas.addEventListener('pointermove', this.prolongerTrait);
    this.canvas.addEventListener('pointerup', this.terminerTrait);
    this.canvas.addEventListener('pointercancel', this.terminerTrait);
    this.canvas.addEventListener('pointerleave', this.terminerTrait);

    this.querySelector('[data-sig-effacer]')?.addEventListener('click', () => this.effacer());
    this.querySelector('[data-sig-mode]')?.addEventListener('click', (evenement) => {
      evenement.preventDefault();
      this.basculerMode();
    });
    this.champNom?.addEventListener('input', () => this.signaler());

    this.observateur = new ResizeObserver(() => this.ajusterEtRedessiner());
    this.observateur.observe(this.canvas);
    this.ajusterEtRedessiner();
  }

  disconnectedCallback(): void {
    this.observateur?.disconnect();
  }

  /* ---------------- Capture ---------------- */

  private pointDepuis(evenement: PointerEvent): Point {
    const cadre = this.canvas!.getBoundingClientRect();
    return { x: evenement.clientX - cadre.left, y: evenement.clientY - cadre.top };
  }

  private debuterTrait = (evenement: PointerEvent): void => {
    if (this.modeTexte) return;
    evenement.preventDefault();
    this.canvas!.setPointerCapture(evenement.pointerId);
    this.traitCourant = [this.pointDepuis(evenement)];
    this.traits.push(this.traitCourant);
  };

  private prolongerTrait = (evenement: PointerEvent): void => {
    if (!this.traitCourant) return;
    evenement.preventDefault();
    const point = this.pointDepuis(evenement);
    const dernier = this.traitCourant[this.traitCourant.length - 1]!;
    // Un point tous les ~1,5 px suffit : au-delà on alourdit sans rien gagner à l'œil.
    if (Math.hypot(point.x - dernier.x, point.y - dernier.y) < 1.5) return;
    this.traitCourant.push(point);
    this.redessiner();
  };

  private terminerTrait = (): void => {
    if (!this.traitCourant) return;
    this.traitCourant = null;
    this.redessiner();
    this.signaler();
  };

  /* ---------------- Rendu ---------------- */

  private ajusterEtRedessiner(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const cadre = canvas.getBoundingClientRect();
    if (cadre.width === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cadre.width * ratio);
    canvas.height = Math.round(cadre.height * ratio);
    this.redessiner();
  }

  private tracerSur(contexte: CanvasRenderingContext2D, echelle: number, decalage: Point): void {
    contexte.save();
    contexte.scale(echelle, echelle);
    contexte.translate(-decalage.x, -decalage.y);
    contexte.strokeStyle = COULEUR;
    contexte.lineWidth = EPAISSEUR;
    contexte.lineCap = 'round';
    contexte.lineJoin = 'round';

    for (const trait of this.traits) {
      if (trait.length === 0) continue;
      contexte.beginPath();
      const premier = trait[0]!;
      if (trait.length === 1) {
        // Un point isolé : un disque, sinon rien ne s'affiche.
        contexte.arc(premier.x, premier.y, EPAISSEUR / 2, 0, Math.PI * 2);
        contexte.fillStyle = COULEUR;
        contexte.fill();
        continue;
      }
      contexte.moveTo(premier.x, premier.y);
      // Lissage : on relie les points médians par des quadratiques, ce qui gomme
      // l'échantillonnage saccadé du doigt sans déformer le geste.
      for (let i = 1; i < trait.length - 1; i += 1) {
        const point = trait[i]!;
        const suivant = trait[i + 1]!;
        contexte.quadraticCurveTo(point.x, point.y, (point.x + suivant.x) / 2, (point.y + suivant.y) / 2);
      }
      const dernier = trait[trait.length - 1]!;
      contexte.lineTo(dernier.x, dernier.y);
      contexte.stroke();
    }
    contexte.restore();
  }

  private redessiner(): void {
    const canvas = this.canvas;
    const contexte = this.contexte;
    if (!canvas || !contexte) return;
    const ratio = canvas.width / Math.max(canvas.getBoundingClientRect().width, 1);
    contexte.clearRect(0, 0, canvas.width, canvas.height);
    this.tracerSur(contexte, ratio, { x: 0, y: 0 });
  }

  /* ---------------- Mesures ---------------- */

  private longueurTotale(): number {
    let total = 0;
    for (const trait of this.traits) {
      for (let i = 1; i < trait.length; i += 1) {
        const a = trait[i - 1]!;
        const b = trait[i]!;
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
    return total;
  }

  private boiteEncre(): { x: number; y: number; largeur: number; hauteur: number } | null {
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const trait of this.traits) {
      for (const point of trait) {
        if (point.x < xMin) xMin = point.x;
        if (point.y < yMin) yMin = point.y;
        if (point.x > xMax) xMax = point.x;
        if (point.y > yMax) yMax = point.y;
      }
    }
    if (!Number.isFinite(xMin)) return null;
    return {
      x: xMin - MARGE,
      y: yMin - MARGE,
      largeur: xMax - xMin + MARGE * 2,
      hauteur: yMax - yMin + MARGE * 2,
    };
  }

  /* ---------------- API publique ---------------- */

  /** Le bloc contient-il quelque chose d'exploitable ? */
  estRempli(): boolean {
    if (this.modeTexte) return (this.champNom?.value.trim().length ?? 0) >= 2;
    return this.traits.length > 0 && this.longueurTotale() >= LONGUEUR_MIN;
  }

  effacer(): void {
    this.traits = [];
    this.traitCourant = null;
    if (this.champNom) this.champNom.value = '';
    this.redessiner();
    this.signaler();
  }

  /**
   * Exporte le tracé en `data:image/png;base64,…`, recadré sur l'encre.
   * Retourne `null` si le bloc est vide ou si le tracé est trop pauvre pour valoir signature.
   */
  versPng(): string | null {
    if (!this.estRempli()) return null;
    if (this.modeTexte) return this.rendreNomTape();

    const boite = this.boiteEncre();
    if (!boite) return null;

    const echelle = Math.min(3, EXPORT_LARGEUR_MAX / boite.largeur, EXPORT_HAUTEUR_MAX / boite.hauteur);
    const sortie = document.createElement('canvas');
    sortie.width = Math.max(8, Math.round(boite.largeur * echelle));
    sortie.height = Math.max(8, Math.round(boite.hauteur * echelle));
    const contexte = sortie.getContext('2d');
    if (!contexte) return null;

    // Aucun fillRect : le fond reste transparent et se pose sur la ligne du PDF.
    this.tracerSur(contexte, echelle, { x: boite.x, y: boite.y });
    return sortie.toDataURL('image/png');
  }

  /* ---------------- Repli « nom tapé » ---------------- */

  private basculerMode(): void {
    this.modeTexte = !this.modeTexte;
    this.dataset.mode = this.modeTexte ? 'texte' : 'trace';
    const bascule = this.querySelector('[data-sig-mode]');
    if (bascule) {
      bascule.textContent = this.modeTexte
        ? 'Je préfère dessiner ma signature'
        : 'Je ne peux pas dessiner — signer en tapant mon nom';
    }
    this.effacer();
    if (this.modeTexte) this.champNom?.focus();
  }

  private rendreNomTape(): string | null {
    const nom = this.champNom?.value.trim();
    if (!nom) return null;

    const police = 'italic 96px "Segoe Script", "Brush Script MT", "Apple Chancery", cursive, serif';
    const mesure = document.createElement('canvas').getContext('2d');
    if (!mesure) return null;
    mesure.font = police;
    const largeur = Math.ceil(mesure.measureText(nom).width) + MARGE * 4;

    const sortie = document.createElement('canvas');
    sortie.width = Math.min(EXPORT_LARGEUR_MAX, Math.max(8, largeur));
    sortie.height = 160;
    const contexte = sortie.getContext('2d');
    if (!contexte) return null;

    contexte.font = police;
    contexte.fillStyle = COULEUR;
    contexte.textBaseline = 'middle';
    contexte.fillText(nom, MARGE * 2, sortie.height / 2);
    return sortie.toDataURL('image/png');
  }

  private signaler(): void {
    const rempli = this.estRempli();
    // Pilote l'effacement du repère « Signez ici » : en CSS seul, on ne peut pas savoir
    // que le canevas contient de l'encre.
    this.dataset.rempli = rempli ? 'oui' : 'non';
    this.dispatchEvent(new CustomEvent('signature-change', { bubbles: true, detail: { rempli } }));
  }
}

/** Enregistre l'élément personnalisé, une seule fois par page. */
export function definirSignaturePad(): void {
  if (!customElements.get('signature-pad')) {
    customElements.define('signature-pad', SignaturePadElement);
  }
}
