import { config } from './config.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const formatPrice = (n) =>
  n == null || n === '' ? '' : `${String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₽`;

function contactLine(l, role) {
  if (l.username) return `${role} - @${esc(l.username)}`;
  return `${role} - <a href="tg://user?id=${l.user_id}">${esc(l.first_name || 'написать')}</a>`;
}

/** Текст поста в стиле канала SELLERS PLACE (HTML parse mode, лимит подписи 1024) */
export function formatPost(l, reserve = 0) {
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
  if (l.garant) deal.push(`<a href="https://t.me/${esc(config.garantContact)}">Garant 3 процента</a>`);

  const footer = [];
  if (deal.length) footer.push('', deal.join(' / '));
  footer.push('', contactLine(l, l.kind === 'wtb' ? 'Покупатель' : 'Продавец'));
  if (l.status === 'sold') footer.unshift('', '<b>❌ ПРОДАНО</b>');

  let head = lines.join('\n');
  const tail = footer.join('\n');
  let desc = l.description ? `\n\n${esc(l.description)}` : '';
  const limit = 1024 - 20 - reserve;
  const visibleLen = (s) => s.replace(/<[^>]+>/g, '').length;
  while (desc && visibleLen(head + desc + tail) > limit) {
    desc = desc.slice(0, Math.max(0, desc.length - 50)).replace(/&[a-z]*$/, '') + '…';
    if (desc.length < 10) desc = '';
  }
  return (head + desc + '\n' + tail).replace(/\n{3,}/g, '\n\n');
}

export const channelPostUrl = (messageId) => {
  if (!messageId) return null;
  if (config.channelUsername) return `https://t.me/${config.channelUsername}/${messageId}`;
  // Закрытый канал: CHANNEL_ID вида -1001234567890 → ссылка t.me/c/1234567890/<id>
  const internal = String(config.channelId).replace(/^-100/, '');
  return `https://t.me/c/${internal}/${messageId}`;
};
