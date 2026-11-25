// Справочники, общие для сервера и клиента (клиент получает их через /api/meta)
export const CATEGORIES = [
  { id: 'outerwear', name: 'Верхняя одежда', tag: 'верхняяодежда' },
  { id: 'hoodies', name: 'Худи и свитшоты', tag: 'худи' },
  { id: 'knit', name: 'Свитеры и трикотаж', tag: 'трикотаж' },
  { id: 'tops', name: 'Футболки и лонгсливы', tag: 'футболки' },
  { id: 'shirts', name: 'Рубашки', tag: 'рубашки' },
  { id: 'pants', name: 'Брюки и джинсы', tag: 'брюки' },
  { id: 'shoes', name: 'Обувь', tag: 'обувь' },
  { id: 'bags', name: 'Сумки', tag: 'сумки' },
  { id: 'accessories', name: 'Аксессуары', tag: 'аксессуары' },
  { id: 'jewelry', name: 'Украшения', tag: 'украшения' },
  { id: 'other', name: 'Другое', tag: 'другое' },
];

export const DELIVERY = ['CDEK', 'Почта России', 'Яндекс Доставка', 'Avito Доставка', 'Boxberry', 'Любой сервис'];

export const CONDITIONS = ['Новое с биркой', '10/10', '9/10', '8/10', '7/10', '6/10 и ниже'];

export const POPULAR_BRANDS = [
  'Rick Owens', 'Balenciaga', 'Maison Margiela', 'Stone Island', 'Chrome Hearts', 'Raf Simons',
  'Comme des Garçons', 'Yohji Yamamoto', 'Junya Watanabe', 'Undercover', 'Number (N)ine',
  'Vivienne Westwood', 'Enfants Riches Déprimés', 'Prada', 'Burberry', 'Moncler', 'Saint Laurent',
  'Carol Christian Poell', 'Isaac Sellam', 'Boris Bidjan Saberi', 'Julius', 'Kapital', 'Acne Studios',
];
