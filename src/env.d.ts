/// <reference types="astro/client" />

// Cette partie dit à TypeScript : 
// "Si tu vois un import qui finit par .yaml, c'est correct, traite-le comme un objet."
declare module "*.yaml" {
  const value: any;
  export default value;
}

declare module "*.yml" {
  const value: any;
  export default value;
}