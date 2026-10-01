// Known merchants: the sender or the text of a bank row is matched against
// `re` (tested on accent-folded, lower-case text). `cat` is a category hint
// that is mapped onto an existing category by name, never created. `sub`
// marks services that are subscriptions by nature.

export const CATEGORY_HINTS = {
  streaming: ["Suscripciones", "Ocio"],
  music: ["Suscripciones", "Ocio"],
  cloud: ["Suscripciones"],
  software: ["Suscripciones"],
  gaming: ["Ocio", "Videojuegos"],
  telecom: ["Telefonía", "Teléfono", "Internet", "Comunicaciones", "Casa"],
  utilities: ["Suministros", "Luz", "Electricidad", "Facturas", "Casa"],
  insurance: ["Seguros", "Seguro"],
  transport: ["Transporte"],
  shopping: ["Compras"],
  food_delivery: ["Comida", "Restaurantes"],
  restaurant: ["Restaurantes", "Comida", "Ocio"],
  groceries: ["Comida", "Supermercado", "Compras"],
  gym: ["Gimnasio", "Deporte", "Salud"],
  education: ["Formación", "Educación", "Suscripciones"],
  payments: [],
  bank: [],
};

export const KNOWN_MERCHANTS = [
  // streaming and video
  { key: "netflix", name: "Netflix", re: /netflix/, cat: "streaming", sub: true },
  { key: "disney", name: "Disney+", re: /disney ?(plus|\+)|disneyplus|disney\.com/, cat: "streaming", sub: true },
  { key: "hbomax", name: "Max", re: /hbo ?max|hbomax|\bmax\.com|\bhbo\b/, cat: "streaming", sub: true },
  { key: "primevideo", name: "Prime Video", re: /prime ?video|primevideo|amazon prime|amazonprime/, cat: "streaming", sub: true },
  { key: "youtube", name: "YouTube", re: /youtube/, cat: "streaming", sub: true },
  { key: "crunchyroll", name: "Crunchyroll", re: /crunchyroll/, cat: "streaming", sub: true },
  { key: "filmin", name: "Filmin", re: /filmin/, cat: "streaming", sub: true },
  { key: "dazn", name: "DAZN", re: /\bdazn\b/, cat: "streaming", sub: true },
  { key: "movistarplus", name: "Movistar Plus+", re: /movistar ?(plus|\+)|movistarplus/, cat: "streaming", sub: true },
  { key: "twitch", name: "Twitch", re: /twitch/, cat: "streaming", sub: true },
  { key: "patreon", name: "Patreon", re: /patreon/, cat: "streaming", sub: true },
  // music and books
  { key: "spotify", name: "Spotify", re: /spotify/, cat: "music", sub: true },
  { key: "tidal", name: "Tidal", re: /\btidal\b/, cat: "music", sub: true },
  { key: "deezer", name: "Deezer", re: /deezer/, cat: "music", sub: true },
  { key: "audible", name: "Audible", re: /audible/, cat: "music", sub: true },
  { key: "kindle", name: "Kindle", re: /kindle/, cat: "music", sub: true },
  // cloud, software, tools
  { key: "icloud", name: "iCloud", re: /icloud/, cat: "cloud", sub: true },
  { key: "dropbox", name: "Dropbox", re: /dropbox/, cat: "cloud", sub: true },
  { key: "adobe", name: "Adobe", re: /\badobe\b/, cat: "software", sub: true },
  { key: "github", name: "GitHub", re: /github/, cat: "software", sub: true },
  { key: "notion", name: "Notion", re: /\bnotion\b/, cat: "software", sub: true },
  { key: "openai", name: "OpenAI", re: /openai|chatgpt/, cat: "software", sub: true },
  { key: "anthropic", name: "Anthropic", re: /anthropic/, cat: "software", sub: true },
  { key: "canva", name: "Canva", re: /\bcanva\b/, cat: "software", sub: true },
  { key: "figma", name: "Figma", re: /\bfigma\b/, cat: "software", sub: true },
  { key: "slack", name: "Slack", re: /\bslack\b/, cat: "software", sub: true },
  { key: "zoom", name: "Zoom", re: /\bzoom\.us|\bzoom video/, cat: "software", sub: true },
  { key: "onepassword", name: "1Password", re: /1password/, cat: "software", sub: true },
  { key: "nordvpn", name: "NordVPN", re: /nordvpn|nordsec/, cat: "software", sub: true },
  { key: "proton", name: "Proton", re: /proton(mail|vpn|\.me)|\bproton ag\b/, cat: "software", sub: true },
  { key: "duolingo", name: "Duolingo", re: /duolingo/, cat: "education", sub: true },
  { key: "strava", name: "Strava", re: /strava/, cat: "gym", sub: true },
  // platforms that bill many things (a subscription only when the text says so)
  { key: "microsoft", name: "Microsoft", re: /microsoft|office ?365|microsoft ?365/, cat: "software", sub: false },
  { key: "xbox", name: "Xbox", re: /\bxbox\b|game ?pass/, cat: "gaming", sub: false },
  { key: "playstation", name: "PlayStation", re: /playstation|\bpsn\b|sony interactive/, cat: "gaming", sub: false },
  { key: "nintendo", name: "Nintendo", re: /nintendo/, cat: "gaming", sub: false },
  { key: "steam", name: "Steam", re: /steampowered|\bsteam\b|valve corp/, cat: "gaming", sub: false },
  { key: "apple", name: "Apple", re: /\bapple\b|app store|itunes|apple\.com/, cat: "software", sub: false },
  { key: "googleplay", name: "Google Play", re: /google ?play|googleplay/, cat: "software", sub: false },
  { key: "googlestore", name: "Google Store", re: /google ?store|googlestore/, cat: "shopping", sub: false },
  { key: "google", name: "Google", re: /google|play\.google/, cat: "software", sub: false },
  // telecom and utilities
  { key: "movistar", name: "Movistar", re: /movistar|telefonica/, cat: "telecom", sub: false },
  { key: "vodafone", name: "Vodafone", re: /vodafone/, cat: "telecom", sub: false },
  { key: "orange", name: "Orange", re: /\borange\b/, cat: "telecom", sub: false },
  { key: "digi", name: "Digi", re: /\bdigi\b|digimobil|digi spain/, cat: "telecom", sub: false },
  { key: "masmovil", name: "MásMóvil", re: /masmovil|mas movil|yoigo|pepephone/, cat: "telecom", sub: false },
  { key: "iberdrola", name: "Iberdrola", re: /iberdrola/, cat: "utilities", sub: false },
  { key: "endesa", name: "Endesa", re: /endesa/, cat: "utilities", sub: false },
  { key: "naturgy", name: "Naturgy", re: /naturgy|gas natural/, cat: "utilities", sub: false },
  { key: "holaluz", name: "Holaluz", re: /holaluz/, cat: "utilities", sub: false },
  { key: "aguas", name: "Aguas", re: /aguas de|canal de isabel|aigues de/, cat: "utilities", sub: false },
  // insurance
  { key: "mapfre", name: "Mapfre", re: /mapfre/, cat: "insurance", sub: false },
  { key: "axa", name: "AXA", re: /\baxa\b/, cat: "insurance", sub: false },
  { key: "lineadirecta", name: "Línea Directa", re: /linea directa|lineadirecta/, cat: "insurance", sub: false },
  { key: "mutua", name: "Mutua Madrileña", re: /mutua madrilena|mutuamadrilena/, cat: "insurance", sub: false },
  { key: "allianz", name: "Allianz", re: /allianz/, cat: "insurance", sub: false },
  // transport
  { key: "renfe", name: "Renfe", re: /renfe/, cat: "transport", sub: false },
  { key: "ryanair", name: "Ryanair", re: /ryanair/, cat: "transport", sub: false },
  { key: "vueling", name: "Vueling", re: /vueling/, cat: "transport", sub: false },
  { key: "iberia", name: "Iberia", re: /\biberia\b/, cat: "transport", sub: false },
  { key: "uber", name: "Uber", re: /\buber\b(?! ?eats)/, cat: "transport", sub: false },
  { key: "cabify", name: "Cabify", re: /cabify/, cat: "transport", sub: false },
  { key: "bolt", name: "Bolt", re: /\bbolt\.eu|bolt (ride|taxi|food)/, cat: "transport", sub: false },
  { key: "blablacar", name: "BlaBlaCar", re: /blablacar/, cat: "transport", sub: false },
  // food delivery
  { key: "glovo", name: "Glovo", re: /glovo/, cat: "food_delivery", sub: false },
  { key: "ubereats", name: "Uber Eats", re: /uber ?eats/, cat: "food_delivery", sub: false },
  { key: "justeat", name: "Just Eat", re: /just ?eat|justeat/, cat: "food_delivery", sub: false },
  { key: "deliveroo", name: "Deliveroo", re: /deliveroo/, cat: "food_delivery", sub: false },
  // restaurants and shops that confirm orders by mail
  { key: "mcdonalds", name: "McDonald's", re: /mcdonald/, cat: "restaurant", sub: false },
  { key: "burgerking", name: "Burger King", re: /burger ?king|burgerking/, cat: "restaurant", sub: false },
  { key: "papajohns", name: "Papa John's", re: /papa ?john|pjespana/, cat: "restaurant", sub: false },
  { key: "dominos", name: "Domino's", re: /domino.?s ?pizza|dominos/, cat: "restaurant", sub: false },
  { key: "telepizza", name: "Telepizza", re: /telepizza/, cat: "restaurant", sub: false },
  { key: "kfc", name: "KFC", re: /\bkfc\b/, cat: "restaurant", sub: false },
  { key: "starbucks", name: "Starbucks", re: /starbucks/, cat: "restaurant", sub: false },
  { key: "mercadona", name: "Mercadona", re: /mercadona/, cat: "groceries", sub: false },
  { key: "carrefour", name: "Carrefour", re: /carrefour/, cat: "groceries", sub: false },
  { key: "lidl", name: "Lidl", re: /\blidl\b/, cat: "groceries", sub: false },
  { key: "mediamarkt", name: "MediaMarkt", re: /media ?markt/, cat: "shopping", sub: false },
  { key: "decathlon", name: "Decathlon", re: /decathlon/, cat: "shopping", sub: false },
  { key: "leroymerlin", name: "Leroy Merlin", re: /leroy ?merlin/, cat: "shopping", sub: false },
  { key: "pcspecialist", name: "PCSpecialist", re: /pc ?specialist/, cat: "shopping", sub: false },
  // shopping
  { key: "amazon", name: "Amazon", re: /amazon|\bamzn\b/, cat: "shopping", sub: false },
  { key: "aliexpress", name: "AliExpress", re: /aliexpress/, cat: "shopping", sub: false },
  { key: "zalando", name: "Zalando", re: /zalando/, cat: "shopping", sub: false },
  { key: "elcorteingles", name: "El Corte Inglés", re: /corte ingles|elcorteingles/, cat: "shopping", sub: false },
  { key: "ikea", name: "IKEA", re: /\bikea\b/, cat: "shopping", sub: false },
  { key: "pccomponentes", name: "PcComponentes", re: /pccomponentes/, cat: "shopping", sub: false },
  { key: "ebay", name: "eBay", re: /\bebay\b/, cat: "shopping", sub: false },
  { key: "wallapop", name: "Wallapop", re: /wallapop/, cat: "shopping", sub: false },
  { key: "temu", name: "Temu", re: /\btemu\b/, cat: "shopping", sub: false },
  { key: "shein", name: "Shein", re: /\bshein\b/, cat: "shopping", sub: false },
  // gyms
  { key: "basicfit", name: "Basic-Fit", re: /basic ?fit|basic-fit/, cat: "gym", sub: true },
  { key: "mcfit", name: "McFit", re: /mcfit/, cat: "gym", sub: true },
  { key: "gympass", name: "Gympass", re: /gympass|wellhub/, cat: "gym", sub: true },
  // payment gateways and banks: the merchant is somewhere else in the text
  { key: "paypal", name: "PayPal", re: /paypal/, cat: "payments", gateway: true },
  { key: "stripe", name: "Stripe", re: /\bstripe\b/, cat: "payments", gateway: true },
  { key: "bizum", name: "Bizum", re: /bizum/, cat: "payments", gateway: true },
];

/** Categories whose merchants are never a subscription by themselves: only explicit membership wording makes one. */
export const SHOP_CATS = new Set(["shopping", "food_delivery", "restaurant", "groceries", "transport"]);

export const BANK_RE = /\b(bbva|santander|caixabank|caixa|ing|sabadell|bankinter|openbank|revolut|n26|unicaja|abanca|kutxabank|ibercaja|cajamar|evo ?banco|banco|bank|cajasur|caja rural|wise|monzo|visa|mastercard|american express|amex)\b/;

const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export { fold };

/** Known merchant whose pattern matches the text, or null. Specific entries come first in the table. */
export function knownMerchant(text) {
  const folded = fold(text);
  if (!folded.trim()) return null;
  for (const m of KNOWN_MERCHANTS) if (m.re.test(folded)) return m;
  return null;
}

export const knownByKey = (key) => KNOWN_MERCHANTS.find((m) => m.key === key) || null;
