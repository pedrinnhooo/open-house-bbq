/**
 * Configuração do churrasco
 * -------------------------
 * Edite este arquivo e dê refresh na página (Cmd+Shift+R).
 * O app busca este arquivo sem cache a cada carregamento.
 *
 * Se mudar os IDs dos itens, atualize também firestore.rules (validItem).
 */

export const CONFIG = {
  brand: {
    name: "Open House",
    accent: "BBQ",
    fullName: "Open House BBQ",
    documentTitle: "Open House BBQ"
  },

  // Dono / anfitrião — se tiver name, a marca vira "Churrasco do {name}".
  // Deixe vazio ("") para manter o brand padrão (Open House BBQ).
  host: {
    name: ""
    // name: "Ciampa"
  },

  // Quem pode abrir o painel admin
  admins: [
    "pedro.ruffo.dev@gmail.com"
  ],

  event: {
    kicker: "Sábado · 2026",
    dateShort: "12 de dezembro",
    dateFull: "12 de dezembro de 2026",
    dateCompact: "12/12/2026",
    time: "13:00",
    place: "Salão de festa",
    addressLine1: "R. Francisco Tapajós, 359",
    addressLine2: "Vila da Saúde",
    addressCity: "São Paulo - SP",
    nickname: "Open House BBQ",
    coords: {
      lat: -23.6261209,
      lng: -46.6249828
    }
  },

  // Itens + vagas
  items: [
    { id: "carne-bovina", name: "🥩 Carne bovina", category: "Churrasco", capacity: 12 },
    { id: "linguica", name: "🌭 Linguiça", category: "Churrasco", capacity: 7 },
    { id: "frango", name: "🍗 Frango", category: "Churrasco", capacity: 6 },
    { id: "pao-alho", name: "🥖 Pão de alho", category: "Churrasco", capacity: 6 },
    { id: "queijo", name: "🧀 Queijo coalho", category: "Churrasco", capacity: 4 }
  ],

  copy: {
    participateLabel: "Vou participar do Open House",
    receiptEyebrow: "Open House BBQ",
    receiptTitle: "Presença confirmada!",
    receiptLede: "Estamos esperando por você.",
    receiptFooter: "Guarde esta confirmação. Nos vemos lá."
  }
};
