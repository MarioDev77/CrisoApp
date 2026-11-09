import type { ReactNode } from 'react';

// Biblioteca de ícones Crisoverde (SVG inline, sem innerHTML e sem recursos externos: compatível com a CSP).
// Ícones de navegação usam currentColor; os de material (material-*) têm cores próprias.

const nav: Record<string, ReactNode> = {
  'bell': <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></>,
  'cart': <><path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 1.9-1.4L22 8H6"/><circle cx="10" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/></>,
  'coins': <><ellipse cx="10" cy="6.5" rx="6" ry="2.5"/><path d="M4 6.5v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4M4 10.5v4c0 1.4 2.7 2.5 6 2.5 1.1 0 2.1-.1 3-.4"/><path d="M14 13.5c0-1.1 1.8-2 4-2s4 .9 4 2-1.8 2-4 2-4-.9-4-2ZM14 13.5v4c0 1.1 1.8 2 4 2s4-.9 4-2v-4"/></>,
  'help': <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.6 1.7c-1.2 1.2-2.1 1.4-2.1 3"/><path d="M12 17.5h.01"/></>,
  'history': <><path d="M5 4.5h14v15H5z"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M3 7v10"/></>,
  'home': <><path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.5 9.8v10.4h13V9.8M9.5 20.2v-6.4h5v6.4"/></>,
  'leaf': <><path d="M20.5 3.5C11 3.5 5 6.8 5 13.2c0 3.2 2.1 5.3 5.1 5.3 6.2 0 10.4-6.1 10.4-15Z"/><path d="M3.5 21c3.2-5.2 7.1-8.5 12.2-11.2"/></>,
  'lock': <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/><path d="M12 16v2"/></>,
  'logout': <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/><path d="M14 8l4 4-4 4M8 12h10"/></>,
  'qr-scan': <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 8h3v3H8zM15 8h1.5v1.5H15zM8 15h1.5v1.5H8zM13 13h3v3h-3zM17 17h1v1h-1z"/></>,
  'recycle': <><path d="m9.1 5.2 1.5-2.1 3.1 5.3-2.2 1.3"/><path d="m10.6 3.1-2.8.2-1.5 2.5M16.1 9.1l2.5.1 2.1 3.7-2.1 1.2"/><path d="m20.7 12.9-.9 2.6-2.9.1M8 14.2l-1.2 2.1-2.2-3.8 2.2-1.3"/><path d="m4.6 12.5.9-2.5 2.7-.1M9.2 19.1l-1.4 1.7h6.1v-2.5"/><path d="m7.8 20.8 2.2.1 1.5-2.1"/></>,
  'settings': <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 13.5 1.1.8-1.5 2.6-1.3-.5a7.8 7.8 0 0 1-1.7 1l-.2 1.4h-3l-.3-1.4a7.8 7.8 0 0 1-1.7-1l-1.3.5-1.5-2.6 1.1-.8a7 7 0 0 1 0-2l-1.1-.8 1.5-2.6 1.3.5a7.8 7.8 0 0 1 1.7-1l.3-1.4h3l.2 1.4a7.8 7.8 0 0 1 1.7 1l1.3-.5 1.5 2.6-1.1.8a7 7 0 0 1 0 2Z"/></>,
  'shield-check': <><path d="M12 3 20 6v5.5c0 4.6-3.2 7.7-8 9.5-4.8-1.8-8-4.9-8-9.5V6l8-3Z"/><path d="m8.5 12 2.3 2.3 4.8-5"/></>,
  'star': <><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></>,
  'store': <><path d="M4 10v10h16V10M3 10l2-6h14l2 6"/><path d="M3 10c0 1.4 1 2.5 2.5 2.5S8 11.4 8 10c0 1.4 1 2.5 2.5 2.5S13 11.4 13 10c0 1.4 1 2.5 2.5 2.5S18 11.4 18 10c0 1.4 1 2.5 2.5 2.5"/><path d="M9 20v-5h6v5"/></>,
  'support': <><path d="M4 13v-2a8 8 0 0 1 16 0v2"/><path d="M4 12H3a1 1 0 0 0-1 1v4a2 2 0 0 0 2 2h2v-7H4ZM20 12h1a1 1 0 0 1 1 1v4a2 2 0 0 1-2 2h-2v-7h2ZM18 19c-.5 1.5-2 2-4 2"/></>,
};
const mat: Record<string, ReactNode> = {
  'material-aluminum': <><path d="M15 10h18l-1.5 29h-15Z" fill="#B8C9C4" stroke="#426F63" strokeWidth="1.8"/><path d="M15 10h18l-1-4H16Z" fill="#D8E4E0" stroke="#426F63" strokeWidth="1.5"/><path d="M17 16h14v17H17z" fill="#4C9A79"/><path d="M24 19c-4 3-4 7 0 10 4-3 4-7 0-10Z" fill="#E6F2D9"/><path d="M22 28c2-3 4-5 7-6" fill="none" stroke="#E6F2D9" strokeWidth="1.4" strokeLinecap="round"/><path d="M18 38h12" stroke="#426F63" strokeWidth="1.6"/></>,
  'material-cardboard': <><path d="M7 15 24 5l17 10v19L24 44 7 34Z" fill="#D9A66F"/><path d="M7 15 24 25l17-10M24 25v19" fill="none" stroke="#8A5B36" strokeWidth="2.2" strokeLinejoin="round"/><path d="m16 10 17 10-9 5-17-10Z" fill="#F0C18D"/><path d="m24 25 17-10v8L24 33Z" fill="#C68B55"/><path d="m19 13 8-5 8 5-8 5Z" fill="#EBC397"/></>,
  'material-glass': <><path d="M19 5h10v5l3 4v25a3 3 0 0 1-3 3H19a3 3 0 0 1-3-3V14l3-4Z" fill="#8DC9A4" stroke="#276B4C" strokeWidth="1.8" strokeLinejoin="round"/><path d="M19 5h10v5H19z" fill="#276B4C"/><path d="M18 17h12v17H18z" fill="#B9E5C7" opacity=".55"/><path d="M21 18v16" stroke="#E8F6EC" strokeWidth="2" strokeLinecap="round"/><path d="M20 39h8" stroke="#276B4C" strokeWidth="1.6"/></>,
  'material-plastic': <><path d="M20 5h8v5l4 4v25a3 3 0 0 1-3 3H19a3 3 0 0 1-3-3V14l4-4Z" fill="#B9E4D7" stroke="#287A62" strokeWidth="1.8" strokeLinejoin="round"/><path d="M20 5h8v5h-8z" fill="#2D8C70"/><path d="M17 19h14v15H17z" fill="#8BCDB8" opacity=".9"/><path d="M20 24c2-3 5-3 7 0 2 3 0 7-3.5 7S18 27 20 24Z" fill="#EAF7F1"/></>,
};
export type IconName = 'bell' | 'cart' | 'coins' | 'help' | 'history' | 'home' | 'leaf' | 'lock' | 'logout' | 'qr-scan' | 'recycle' | 'settings' | 'shield-check' | 'star' | 'store' | 'support';
export type MaterialKey = 'papelao' | 'plastico' | 'aluminio' | 'vidro';
const materialIcon: Record<MaterialKey, string> = { papelao: 'material-cardboard', plastico: 'material-plastic', aluminio: 'material-aluminum', vidro: 'material-glass' };

/** Ícone de navegação. O tamanho é em em, então acompanha o font-size do contêiner (inclusive nos breakpoints). */
export function Icon({ name, size = 1.25, inline = false }: { name: IconName; size?: number; inline?: boolean }) {
  return <svg className={inline ? 'icon icon-inline' : 'icon'} width={`${size}em`} height={`${size}em`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{nav[name]}</svg>;
}
/** Pictograma colorido do material reciclável. */
export function MaterialIcon({ material, size = 1.6, inline = false }: { material: MaterialKey; size?: number; inline?: boolean }) {
  return <svg className={inline ? 'icon icon-inline' : 'icon'} width={`${size}em`} height={`${size}em`} viewBox="0 0 48 48" aria-hidden="true" focusable="false">{mat[materialIcon[material]]}</svg>;
}
