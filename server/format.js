import { CATEGORIES } from './catalog.js';
import { config } from './config.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const formatPrice = (n) =>
  n == null || n === '' ? '' : `${String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₽`;

const brandTag = (brand) => brand.replace(/[^\p{L}\p{N}]+/gu, '');

function contactLine(l, role) {
  if (l.username) return `${role} - @${esc(l.username)}`;
  return `${role} - <a href="tg://user?id=${l.user_id}">${esc(l.first_name || 'написать')}</a>`;
}

/** Текст поста в стиле канала SELLERS PLACE (HTML parse mode, лимит подписи 1024) */
export function formatPost(l) {
  const cat = CATEGORIES.find((c) => c.id === l.category);
  const title = [l.brand, l.model].filter(Boolean).map(esc).join(' | ');
  const lines = [];

  if (l.kind === 'wtb') {
    lines.push(`🔎 <b>ИЩУ: ${title}</b>`, '');
    if (l.size) lines.push(`Размер: ${esc(l.size)}`);
    if (l.condition) lines.push(`Состояние: от ${esc(l.condition)}`);
    if (l.price) lines.push(`Бюджет: до ${formatPrice(l.price)}`);
  } else {
    lines.push(`<b>${title}</b>`, '');
    if (l.condition) lines.push(`Состояние: ${esc(l.condition)}`, '');
    if (l.size) lines.push(`Размер: ${esc(l.size)}`, '');
    lines.push(`Цена: ${formatPrice(l.price)}${l.negotiable ? ', торг возможен' : ''}`, '');
    lines.push(`Обмен: ${l.exchange ? 'Да' : 'Нет'}`);
  }

  const deal = [];
  if (l.meetup && l.city) deal.push(`Личная встреча ${esc(l.city)}`);
  deal.push(...l.delivery.map(esc));
  if (l.garant) deal.push('Garant 3 процента');

  const footer = [];
  if (deal.length) footer.push('', deal.join(' / '));
  footer.push('', contactLine(l, l.kind === 'wtb' ? 'Покупатель' : 'Продавец'));
  const tags = [l.kind === 'wtb' ? '#поиск' : '#продажа', cat ? `#${cat.tag}` : '', `#${brandTag(l.brand)}`];
  footer.push('', tags.filter((t) => t.length > 1).join(' '));
  if (l.status === 'sold') footer.unshift('', '<b>❌ ПРОДАНО</b>');

  let head = lines.join('\n');
  const tail = footer.join('\n');
  let desc = l.description ? `\n\n${esc(l.description)}` : '';
  const limit = 1024 - 20;
  const visibleLen = (s) => s.replace(/<[^>]+>/g, '').length;
  while (desc && visibleLen(head + desc + tail) > limit) {
    desc = desc.slice(0, Math.max(0, desc.length - 50)).replace(/&[a-z]*$/, '') + '…';
    if (desc.length < 10) desc = '';
  }
  return (head + desc + '\n' + tail).replace(/\n{3,}/g, '\n\n');
}

export const channelPostUrl = (messageId) =>
  messageId ? `https://t.me/${config.channelUsername}/${messageId}` : null;
