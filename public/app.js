
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Sem cache: cada refresh pega o config.js mais novo
const { CONFIG: RAW_CONFIG } = await import(
  `./config.js?t=${Date.now()}`
);

function buildConfig(raw) {
  const host = { ...(raw.host || {}) };
  const hostName = String(host.name || "").trim();
  const defaults = raw.brand || {};
  const event = { ...(raw.event || {}) };
  const copy = { ...(raw.copy || {}) };

  event.addressFull = [
    event.addressLine1,
    event.addressLine2
  ].filter(Boolean).join(" - ") + (event.addressCity ? `, ${event.addressCity}` : "");
  event.addressHtml = [event.addressLine1, event.addressLine2]
    .filter(Boolean)
    .join("<br>");

  // Com host.name → marca vira "Churrasco do {nome}"; sem → default do config
  const brand = hostName
    ? {
        name: "Churrasco do",
        accent: hostName,
        fullName: `Churrasco do ${hostName}`,
        documentTitle: `Churrasco do ${hostName}`
      }
    : {
        name: defaults.name || "Open House",
        accent: defaults.accent || "BBQ",
        fullName: defaults.fullName || "Open House BBQ",
        documentTitle: defaults.documentTitle || defaults.fullName || "Open House BBQ"
      };

  if (hostName) {
    if (!event.nickname || event.nickname === defaults.fullName) {
      event.nickname = brand.fullName;
    }
    if (!copy.participateLabel || /Open House/i.test(copy.participateLabel)) {
      copy.participateLabel = `Vou participar do ${brand.fullName}`;
    }
    if (!copy.receiptEyebrow || /Open House/i.test(copy.receiptEyebrow)) {
      copy.receiptEyebrow = brand.fullName;
    }
  }

  return {
    ...raw,
    brand,
    host,
    admins: raw.admins || [],
    event,
    items: raw.items || [],
    copy
  };
}

const CONFIG = buildConfig(RAW_CONFIG);

// Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCSj__eG6LftnnxxJD7SvJ2Up_-Si_tP9o",
  authDomain: "open-house-bbq.firebaseapp.com",
  projectId: "open-house-bbq",
  storageBucket: "open-house-bbq.firebasestorage.app",
  messagingSenderId: "78187718949",
  appId: "1:78187718949:web:23992e6e9c47b57f8212cc",
  measurementId: "G-H79Y057H79"
};

const ADMIN_EMAILS = CONFIG.admins.map(email => String(email).trim().toLowerCase());

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

let currentUser = null;
let stopClaims = null;
let currentClaims = [];

const ITEMS = CONFIG.items.map(item => ({
  id: item.id,
  name: item.name,
  category: item.category || "Churrasco",
  capacity: Number(item.capacity) || 0,
  active: item.active !== false
}));

const isAdmin = email =>
  ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());

const userEmail = () =>
  String(currentUser?.email || "").trim().toLowerCase();

function itemById(id) {
  return ITEMS.find(item => item.id === id);
}

function applyEventConfig() {
  const { brand, event, copy } = CONFIG;

  document.title = brand.documentTitle || brand.fullName;

  document.querySelectorAll("[data-config]").forEach(el => {
    const key = el.getAttribute("data-config");
    const htmlKey = el.getAttribute("data-config-html");

    if (htmlKey === "event.addressHtml") {
      el.innerHTML = event.addressHtml;
      return;
    }

    const map = {
      "brand.fullName": brand.fullName,
      "brand.documentTitle": brand.documentTitle || brand.fullName,
      "brand.name": brand.name,
      "brand.accent": brand.accent,
      "event.kicker": event.kicker,
      "event.dateShort": event.dateShort,
      "event.dateFull": event.dateFull,
      "event.dateCompact": event.dateCompact,
      "event.time": event.time,
      "event.place": event.place,
      "event.addressLine1": event.addressLine1,
      "event.addressLine2": event.addressLine2,
      "event.addressFull": event.addressFull,
      "copy.participateLabel": copy.participateLabel,
      "copy.receiptEyebrow": copy.receiptEyebrow,
      "copy.receiptTitle": copy.receiptTitle,
      "copy.receiptLede": copy.receiptLede,
      "copy.receiptFooter": copy.receiptFooter
    };

    if (key && map[key] != null) {
      el.textContent = map[key];
    }
  });

  const brandEl = document.querySelector("[data-config-brand]");
  if (brandEl) {
    const safe = value => String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
    brandEl.innerHTML = `${safe(brand.name)} <em>${safe(brand.accent)}</em>`;
  }
}

function googleDisplayName() {
  return String(currentUser?.displayName || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function isSafePersonName(name) {
  return /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[ '\-][A-Za-zÀ-ÖØ-öø-ÿ]+)+$/.test(name)
    && name.length >= 3
    && name.length <= 90
    && !/(prompt|ignore previous|system:|<\s*script|[{}`]|--|\/\*|\*\/|;)/i.test(name);
}

function fillLockedName() {
  const nameInput = $("name");
  const nameDisplay = $("nameDisplay");
  if (!nameInput || !nameDisplay) return;

  const name = googleDisplayName();
  nameInput.value = name;
  nameDisplay.textContent = name || "Nome indisponível na conta Google";
  nameDisplay.classList.toggle("is-empty", !name);
}

function validateReservationInput({ name, attending, itemId }) {
  const lockedName = googleDisplayName();

  if (!lockedName) {
    throw new Error("Sua conta Google precisa de um nome válido (nome e sobrenome).");
  }

  if (!isSafePersonName(lockedName)) {
    throw new Error("Sua conta Google precisa de um nome válido (nome e sobrenome).");
  }

  if (name !== lockedName) {
    throw new Error("O nome precisa ser o da sua conta Google.");
  }

  if (!attending) {
    throw new Error("Marque que você vai participar do Open House.");
  }

  if (!itemId || !itemById(itemId)) {
    throw new Error("Escolha um item válido para levar.");
  }
}

function revealPage() {
  window.scrollTo(0, 0);
  document.documentElement.classList.remove("auth-pending");
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function showMessage(message) {
  const notice = $("notice");
  notice.classList.remove("is-welcome", "is-confirmed");
  notice.classList.add("is-alert");
  $("noticeTitle").textContent = message;
  $("noticeText").textContent = "";
  $("openVoucher").classList.add("hidden");
}

let toastTimer = 0;

function friendlyError(error, fallback = "Algo deu errado. Tente de novo.") {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (
    message.includes("já foi realizada") ||
    message.includes("Não é possível votar")
  ) {
    return {
      title: "Inscrição já feita",
      text: "Sua presença já está registrada. Não dá para confirmar de novo."
    };
  }

  if (message.includes("atingiu o limite")) {
    return {
      title: "Item esgotado",
      text: "Esse item atingiu o limite. Escolha outra opção."
    };
  }

  if (message.includes("nome válido") || message.includes("conta Google")) {
    return {
      title: "Nome inválido",
      text: "Use uma conta Google com nome e sobrenome válidos."
    };
  }

  if (message.includes("Marque que você vai participar")) {
    return {
      title: "Confirme a presença",
      text: "Marque que você vai participar para continuar."
    };
  }

  if (message.includes("Escolha um item") || message.includes("item válido")) {
    return {
      title: "Falta a contribuição",
      text: "Selecione o que você gostaria de levar."
    };
  }

  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return { title: "Login cancelado", text: "Você fechou a janela do Google." };
  }

  if (code === "auth/popup-blocked") {
    return {
      title: "Popup bloqueado",
      text: "Permita popups neste site para entrar com o Google."
    };
  }

  if (code === "auth/network-request-failed" || message.toLowerCase().includes("network")) {
    return {
      title: "Sem conexão",
      text: "Verifique sua internet e tente novamente."
    };
  }

  if (code.startsWith("permission-denied") || message.toLowerCase().includes("permission")) {
    return {
      title: "Sem permissão",
      text: "Não foi possível concluir. Tente sair e entrar de novo."
    };
  }

  if (message && !message.startsWith("Firebase:") && message.length < 120) {
    return { title: "Atenção", text: message };
  }

  return { title: "Ops", text: fallback };
}

function showToast(input, type = "error") {
  const toast = $("toast");
  if (!toast) return;

  const payload = typeof input === "string"
    ? { title: type === "success" ? "Pronto" : "Ops", text: input }
    : input;

  const icon = type === "success"
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8v5.5M12 16.5h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/></svg>`;

  clearTimeout(toastTimer);
  toast.classList.remove("hidden", "is-hiding", "is-visible", "is-success");
  toast.classList.toggle("is-success", type === "success");
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-copy">
      <span class="toast-title">${esc(payload.title || "Ops")}</span>
      <span class="toast-text">${esc(payload.text || "")}</span>
    </span>
  `;

  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  toastTimer = setTimeout(() => {
    toast.classList.add("is-hiding");
    toast.classList.remove("is-visible");
    setTimeout(() => {
      toast.classList.add("hidden");
      toast.classList.remove("is-hiding", "is-success");
      toast.innerHTML = "";
    }, 220);
  }, 3400);
}

function showWelcome(name, detail, canOpenVoucher = false) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const shown = parts.length <= 2
    ? parts.join(" ")
    : `${parts[0]} ${parts[parts.length - 1]}`;
  const notice = $("notice");
  notice.classList.remove("is-alert");
  notice.classList.add("is-welcome");
  notice.classList.toggle("is-confirmed", canOpenVoucher);
  $("guestName").textContent = shown ? `${shown}!` : "Olá!";
  $("noticeTitle").textContent = "";
  $("noticeText").textContent = detail;
  $("openVoucher").classList.toggle("hidden", !canOpenVoucher);
}

function setView(view) {
  const adminView = view === "admin" && isAdmin(userEmail());
  $("homeView").classList.toggle("hidden", adminView);
  $("admin").classList.toggle("hidden", !adminView);
  $("tabHome").classList.toggle("is-active", !adminView);
  $("tabAdmin").classList.toggle("is-active", adminView);
  $("tabHome").setAttribute("aria-selected", String(!adminView));
  $("tabAdmin").setAttribute("aria-selected", String(adminView));
}

function setBusy(button, busy, text) {
  if (!button) return;

  if (!button.dataset.originalHtml) {
    button.dataset.originalHtml = button.innerHTML;
  }

  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");

  if (button.classList.contains("ticket-tool")) {
    button.classList.toggle("is-busy", busy);
    return;
  }

  if (busy) {
    button.textContent = text;
  } else {
    button.innerHTML = button.dataset.originalHtml;
  }
}

// Menu do usuário
$("userMenuButton").onclick = () => {
  $("userDropdown").classList.toggle("hidden");
};

document.addEventListener("click", event => {
  if (!event.target.closest(".user-menu")) {
    $("userDropdown").classList.add("hidden");
  }
});

$("logout").onclick = async () => {
  await signOut(auth);
  $("userDropdown").classList.add("hidden");
};

$("openHistory").onclick = () => {
  openHistory().catch(error => {
    console.error(error);
    $("history").classList.add("is-empty");
    $("historyList").innerHTML = historyEmptyState(
      "Não foi possível carregar o histórico."
    );
  });
};

$("closeHistory").onclick = closeHistory;

// Login Google
$("login").onclick = async () => {
  if (auth.currentUser) {
    await signOut(auth);
    return;
  }

  try {
    const provider = new GoogleAuthProvider();
    provider.addScope("profile");
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    showToast(friendlyError(error, "Não foi possível entrar com o Google."), "error");
  }
};

// Autenticação
onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (user) document.documentElement.classList.add("auth-pending");

  $("login").classList.toggle("hidden", !!user);
  $("userMenu").classList.toggle("hidden", !user);

  if (user) {
    const name = user.displayName || "Minha conta";
    const email = user.email || "";

    $("userName").textContent = name.split(" ")[0];
    $("dropdownName").textContent = name;
    $("dropdownEmail").textContent = email;

    $("userAvatar").src =
      user.photoURL || "https://www.gravatar.com/avatar/?d=mp";

    $("userAvatar").alt = `Foto de ${name}`;
  }

  $("identity").textContent = "";

  $("app").classList.add("hidden");
  $("admin").classList.add("hidden");
  $("viewTabs").classList.add("hidden");
  $("homeView").classList.remove("hidden");

  if (stopClaims) {
    stopClaims();
    stopClaims = null;
  }

  currentClaims = [];

  if (!user) {
    document.body.classList.remove("voted");
    $("receipt").classList.add("hidden");
    showMessage("Entre com sua conta Google para participar.");
    revealPage();
    return;
  }

  try {
    const admin = isAdmin(userEmail());

    const alreadyVoted = await loadReservation();
    const welcome = currentUser.displayName || currentUser.email || "";

    fillLockedName();

    if (alreadyVoted) {
      $("app").classList.add("hidden");
      showWelcome(welcome, "Sua presença já está confirmada.", true);
    } else {
      $("app").classList.remove("hidden");
      showWelcome(welcome, "");
      fillLockedName();
    }

    if (admin) {
      $("viewTabs").classList.remove("hidden");
      setView(alreadyVoted ? "admin" : "home");
      $("backToReceipt").classList.toggle("hidden", !alreadyVoted);
    } else if (alreadyVoted) {
      showReceipt();
      revealPage();
      return;
    }

    revealPage();

    stopClaims = onSnapshot(
      collection(db, "claims"),
      snapshot => {
        currentClaims = snapshot.docs.map(d => ({
          uid: d.id,
          ...d.data()
        }));

        renderItems();

        if (isAdmin(userEmail())) {
          loadAdmin().catch(console.error);
        }
      },
      error => {
        console.error(error);
        showMessage(
          "Não foi possível carregar as opções. Verifique as regras do Firestore."
        );
      }
    );

    if (admin) {
      await loadAdmin();
    }
  } catch (error) {
    console.error(error);
    showMessage(
      "Não foi possível carregar sua inscrição. Confira as regras do Firestore."
    );
    revealPage();
  }
});

// Renderização dos itens
function renderItems() {
  const select = $("item");
  const previous = select.value;

  const myClaim = currentClaims.find(
    claim => claim.uid === currentUser?.uid
  );

  const myItemId = myClaim?.itemId || "";

  select.innerHTML = '<option value="">Selecione um item</option>';

  const groups = {};

  ITEMS.forEach(item => {
    const claimed = currentClaims.filter(
      claim => claim.itemId === item.id
    ).length;

    const remaining = item.capacity - claimed;

    if (remaining <= 0 && myItemId !== item.id) return;

    (groups[item.category] ||= []).push({
      ...item,
      remaining: Math.max(0, remaining)
    });
  });

  Object.entries(groups).forEach(([category, rows]) => {
    const group = document.createElement("optgroup");
    group.label = category;

    rows.forEach(item => {
      const option = document.createElement("option");

      option.value = item.id;
      option.textContent = item.remaining > 0
        ? `${item.name} — ${item.remaining} vaga(s)`
        : `${item.name} — sua escolha`;

      group.append(option);
    });

    select.append(group);
  });

  if ([...select.options].some(option => option.value === previous)) {
    select.value = previous;
  } else if (myItemId) {
    select.value = myItemId;
  }

  select.disabled = !$("attending").checked;
}

// Carrega inscrição

async function loadReservation() {
  const ref = doc(db, "reservations", currentUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    $("reservation").reset();
    $("attending").checked = true;
    $("item").disabled = false;
    fillLockedName();
    return false;
  }

  const reservation = snap.data();
  fillLockedName();

  // O usuário já votou. Não libera uma nova inscrição.
  $("receiptName").textContent = reservation.name || googleDisplayName();
  setReceiptItem(itemById(reservation.itemId)?.name || "Sem contribuição");

  return true;
}

let sheetTimer = 0;

function showReceipt() {
  const receipt = $("receipt");
  clearTimeout(sheetTimer);
  receipt.classList.remove("hidden", "is-closing");
  document.body.classList.add("voted");
  $("successModal").classList.add("hidden");
  $("backHome").classList.remove("hidden");
}

function closeSheet(after) {
  const receipt = $("receipt");
  if (receipt.classList.contains("hidden")) {
    document.body.classList.remove("voted");
    after?.();
    return;
  }
  receipt.classList.add("is-closing");
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => {
    receipt.classList.add("hidden");
    receipt.classList.remove("is-closing");
    document.body.classList.remove("voted");
    after?.();
  }, 280);
}

function backToHome() {
  closeSheet(() => {
    $("app").classList.add("hidden");
    showWelcome(
      currentUser?.displayName || currentUser?.email || "",
      "Sua presença já está confirmada.",
      true
    );
    if (isAdmin(userEmail())) {
      $("viewTabs").classList.remove("hidden");
      setView("home");
    }
    window.scrollTo(0, 0);
  });
}

function openAdminPanel() {
  if (!isAdmin(userEmail())) return;

  closeSheet(() => {
    $("app").classList.add("hidden");
    $("viewTabs").classList.remove("hidden");
    $("backToReceipt").classList.remove("hidden");
    showWelcome(
      currentUser?.displayName || currentUser?.email || "",
      "Sua presença já está confirmada.",
      true
    );
    setView("admin");
    window.scrollTo(0, 0);
  });
}

$("showReceipt").onclick = showReceipt;
$("openVoucher").onclick = showReceipt;
$("notice").onclick = () => {
  if (!$("notice").classList.contains("is-confirmed")) return;
  if ($("openVoucher").classList.contains("hidden")) return;
  showReceipt();
};
$("closeSheet").onclick = () => backToHome();
$("backHome").onclick = () => {
  if (isAdmin(userEmail())) openAdminPanel();
  else backToHome();
};
$("backToReceipt").onclick = showReceipt;
$("tabHome").onclick = () => setView("home");
$("tabAdmin").onclick = () => {
  if (isAdmin(userEmail())) setView("admin");
};


$("attending").onchange = () => {
  $("item").disabled = !$("attending").checked;
  if (!$("attending").checked) $("item").value = "";
};

// Salva inscrição
$("reservation").onsubmit = async event => {
  event.preventDefault();

  if (!currentUser) return;

  const button = $("reservation").querySelector(
    'button[type="submit"]'
  );

  setBusy(button, true, "Enviando...");

  try {
    fillLockedName();
    const name = googleDisplayName();
    const attending = $("attending").checked;
    const itemId = String($("item").value || "").trim();

    validateReservationInput({ name, attending, itemId });

    const reservationRef = doc(db, "reservations", currentUser.uid);
    const claimRef = doc(db, "claims", currentUser.uid);

    const claimsSnapshot = await getDocs(collection(db, "claims"));


    await runTransaction(db, async transaction => {
      const reservationSnap = await transaction.get(reservationRef);
      const claimSnap = await transaction.get(claimRef);

      // Impede uma segunda inscrição
      if (reservationSnap.exists() || claimSnap.exists()) {
        throw new Error("Sua inscrição já foi realizada. Não é possível votar novamente.");
      }

      const claimedByOthers = claimsSnapshot.docs.filter(d =>
        d.id !== currentUser.uid &&
        d.data().itemId === itemId
      ).length;

      const selectedItem = itemById(itemId);

      if (claimedByOthers >= selectedItem.capacity) {
        throw new Error("Esse item atingiu o limite. Escolha outro.");
      }

      transaction.set(claimRef, {
        uid: currentUser.uid,
        itemId
      });

      transaction.set(reservationRef, {
        uid: currentUser.uid,
        email: userEmail(),
        name,
        attending: true,
        itemId,
        createdAt: serverTimestamp()
      });
    });


    $("receiptName").textContent = name;
    setReceiptItem(itemById(itemId)?.name || "");

    $("app").classList.add("hidden");
    showWelcome(name, "Sua presença já está confirmada.", true);

    if (isAdmin(userEmail())) {
      $("viewTabs").classList.remove("hidden");
      $("backToReceipt").classList.remove("hidden");
      setView("home");
    }

    $("successModal").classList.remove("hidden");

    await loadReservation();

    if (isAdmin(userEmail())) {
      await loadAdmin();
    }
  } catch (error) {
    console.error(error);
    showToast(
      friendlyError(error, "Não foi possível salvar sua participação."),
      "error"
    );
  } finally {
    setBusy(button, false);
  }
};


// Painel administrativo
async function loadAdmin() {
  if (!isAdmin(userEmail())) return;

  const [reservationsSnap, claimsSnap] = await Promise.all([
    getDocs(collection(db, "reservations")),
    getDocs(collection(db, "claims"))
  ]);

  const people = reservationsSnap.docs.map(d => d.data());
  const claims = claimsSnap.docs.map(d => d.data());
  adminReport = buildReport(people, claims);

  const confirmed = people.filter(person => person.attending);
  const totalPeople = confirmed.length;

  $("stats").innerHTML = `
    <div class="stat">
      <span class="stat-label">Confirmados</span>
      <b>${confirmed.length}</b>
    </div>

    <div class="stat">
      <span class="stat-label">Pessoas</span>
      <b>${totalPeople}</b>
    </div>

    <div class="stat">
      <span class="stat-label">Itens livres</span>
      <b>${ITEMS.filter(item =>
    claims.filter(claim => claim.itemId === item.id).length < item.capacity
  ).length}</b>
    </div>
  `;

  $("inventory").innerHTML = ITEMS.map(item => {
    const claimed = claims.filter(
      claim => claim.itemId === item.id
    ).length;
    const pct = Math.min(100, Math.round((claimed / item.capacity) * 100));
    const full = claimed >= item.capacity;
    const icon = [...item.name][0] || "•";
    const title = item.name.replace(icon, "").trim();

    return `
      <article class="item-row${full ? " is-full" : ""}">
        <div class="item-icon" aria-hidden="true">${icon}</div>
        <div class="item-copy">
          <div class="item-head">
            <span class="item-title">${esc(title)}</span>
            <strong class="item-count">${claimed}<span>/${item.capacity}</span></strong>
          </div>
          <span class="item-desc">${esc(item.category)}</span>
          <span class="meter" aria-hidden="true"><span style="width:${pct}%"></span></span>
        </div>
      </article>
    `;
  }).join("");

  $("attendees").innerHTML = people.map(person => {
    const itemName = itemById(person.itemId)?.name || "Sem item";
    const itemIcon = [...itemName][0] || "•";
    const itemTitle = itemName.replace(itemIcon, "").trim() || itemName;

    return `
    <article class="person">
      <div class="person-copy">
        <span class="person-name">${esc(person.name)}</span>
        <span class="person-meta">${esc(person.email)}</span>
        <span class="person-item"><span aria-hidden="true">${esc(itemIcon)}</span>${esc(itemTitle)}</span>
      </div>
      <span class="status ${person.attending ? "is-yes" : "is-no"}">${person.attending ? "Confirmado" : "Não irá"}</span>
    </article>
  `;
  }).join("") || '<p class="attendees-empty">Ainda não há inscrições.</p>';
}

function esc(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function setReceiptItem(name) {
  const el = $("receiptItem");
  const raw = String(name || "Sem contribuição").trim();
  const chars = [...raw];
  const icon = chars[0] || "";
  const title = chars.slice(1).join("").trim();
  const hasIcon = icon && title && /\p{Extended_Pictographic}/u.test(icon);

  el.dataset.label = raw;

  if (hasIcon) {
    el.innerHTML = `<span class="item-emoji" aria-hidden="true">${esc(icon)}</span><span>${esc(title)}</span>`;
    return;
  }

  el.textContent = raw;
}

// Atualizar painel
$("refresh").onclick = () => {
  loadAdmin().catch(error => {
    console.error(error);
    showToast({
      title: "Painel offline",
      text: "Não foi possível atualizar agora. Tente de novo em instantes."
    }, "error");
  });
};

const EVENT_ADDRESS = CONFIG.event.addressFull;
const EVENT_NICKNAME = CONFIG.event.nickname || CONFIG.brand.fullName;
const EVENT_COORDS = CONFIG.event.coords;
const encodedAddress = encodeURIComponent(EVENT_ADDRESS);
const encodedNickname = encodeURIComponent(EVENT_NICKNAME);

const UBER_WEB_URL =
  `https://m.uber.com/ul/?action=setPickup` +
  `&dropoff[latitude]=${EVENT_COORDS.lat}` +
  `&dropoff[longitude]=${EVENT_COORDS.lng}` +
  `&dropoff[formatted_address]=${encodedAddress}` +
  `&dropoff[nickname]=${encodedNickname}`;

const UBER_APP_URL =
  `uber://riderequest?dropoff[latitude]=${EVENT_COORDS.lat}` +
  `&dropoff[longitude]=${EVENT_COORDS.lng}` +
  `&dropoff[formatted_address]=${encodedAddress}` +
  `&dropoff[nickname]=${encodedNickname}`;

const WAZE_WEB_URL =
  `https://waze.com/ul?ll=${EVENT_COORDS.lat}%2C${EVENT_COORDS.lng}` +
  `&navigate=yes&zoom=17&q=${encodedAddress}`;

const WAZE_APP_URL =
  `waze://?ll=${EVENT_COORDS.lat},${EVENT_COORDS.lng}&navigate=yes`;

function openNavApp({ appUrl, webUrl }) {
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (!mobile) {
    window.open(webUrl, "_blank", "noopener,noreferrer");
    return;
  }

  let left = false;
  const markLeft = () => { left = true; };
  document.addEventListener("visibilitychange", markLeft, { once: true });
  window.addEventListener("pagehide", markLeft, { once: true });

  window.location.href = appUrl;

  window.setTimeout(() => {
    if (!left) window.location.href = webUrl;
  }, 1100);
}

function closeHistory() {
  $("history").classList.add("hidden");
  $("history").classList.remove("is-empty");
  document.body.classList.remove("is-history");
}

function historySkeleton() {
  return `
    <ol class="history-timeline" aria-hidden="true">
      <li class="history-entry is-skeleton">
        <span class="history-rail"></span>
        <div class="history-stub">
          <span class="skel skel-line skel-sm"></span>
          <span class="skel skel-line skel-lg"></span>
          <span class="skel skel-line"></span>
          <span class="skel skel-line"></span>
        </div>
      </li>
    </ol>
  `;
}

function renderHistoryEntry({ date, title, facts }) {
  return `
    <li class="history-entry">
      <span class="history-rail" aria-hidden="true"></span>
      <article class="history-stub">
        <p class="history-date">${esc(date)}</p>
        <h2>${esc(title)}</h2>
        <ul class="history-facts">
          ${facts.map(([label, value]) => `
            <li>
              <span>${esc(label)}</span>
              <strong>${esc(value)}</strong>
            </li>
          `).join("")}
        </ul>
      </article>
    </li>
  `;
}

function historyEmptyState(message) {
  return `
    <div class="history-empty" role="status">
      <div class="history-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 8.5V6.8A1.8 1.8 0 0 1 5.8 5h12.4A1.8 1.8 0 0 1 20 6.8v1.7a2.2 2.2 0 0 0 0 4.4v1.7a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 14.6v-1.7a2.2 2.2 0 0 0 0-4.4Z" stroke="currentColor" stroke-width="1.7"/>
          <path d="M9 12h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
      </div>
      <p>${esc(message)}</p>
    </div>
  `;
}

async function openHistory() {
  if (!currentUser) return;

  const history = $("history");
  $("userDropdown").classList.add("hidden");
  history.classList.remove("is-empty");
  $("historyList").innerHTML = historySkeleton();
  history.classList.remove("hidden");
  document.body.classList.add("is-history");

  const snap = await getDoc(doc(db, "reservations", currentUser.uid));

  if (!snap.exists()) {
    history.classList.add("is-empty");
    $("historyList").innerHTML = historyEmptyState(
      "Você ainda não confirmou presença em um churrasco."
    );
    return;
  }

  history.classList.remove("is-empty");
  const data = snap.data();
  const brought = data.attending
    ? itemById(data.itemId)?.name || "Sem item"
    : "Não participou";

  $("historyList").innerHTML = `
    <ol class="history-timeline">
      ${renderHistoryEntry({
        date: CONFIG.event.dateFull,
        title: CONFIG.brand.fullName,
        facts: [
          ["Horário", CONFIG.event.time],
          ["Local", CONFIG.event.place],
          ["Endereço", EVENT_ADDRESS],
          ["Você levou", brought]
        ]
      })}
    </ol>
  `;
}

$("uberLink").href = UBER_WEB_URL;
$("wazeLink").href = WAZE_WEB_URL;

$("uberLink").addEventListener("click", event => {
  event.preventDefault();
  openNavApp({ appUrl: UBER_APP_URL, webUrl: UBER_WEB_URL });
});

$("wazeLink").addEventListener("click", event => {
  event.preventDefault();
  openNavApp({ appUrl: WAZE_APP_URL, webUrl: WAZE_WEB_URL });
});

async function copyAddress(button) {
  try {
    await navigator.clipboard.writeText(EVENT_ADDRESS);
    button.classList.add("is-copied");
    clearTimeout(button._copiedTimer);
    button._copiedTimer = setTimeout(() => {
      button.classList.remove("is-copied");
    }, 1800);
  } catch (error) {
    button.classList.remove("is-copied");
    showToast({
      title: "Não copiado",
      text: "Não foi possível copiar. Selecione o endereço manualmente."
    }, "error");
  }
}

$("copyAddress").addEventListener("click", () => copyAddress($("copyAddress")));
$("copyEventAddress").addEventListener("click", () => copyAddress($("copyEventAddress")));

let adminReport = null;

function buildReport(people, claims) {
  const confirmed = people.filter(person => person.attending);
  const totalPeople = confirmed.length;
  const items = ITEMS.map(item => {
    const claimed = claims.filter(claim => claim.itemId === item.id).length;
    return {
      name: item.name,
      claimed,
      capacity: item.capacity,
      pct: Math.min(100, Math.round((claimed / item.capacity) * 100))
    };
  });

  return {
    confirmedCount: confirmed.length,
    totalPeople,
    openItems: items.filter(item => item.claimed < item.capacity).length,
    items,
    people: confirmed.map(person => ({
      name: person.name || "Sem nome",
      email: person.email || "",
      item: itemById(person.itemId)?.name || "Sem item"
    }))
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function canvasFont(weight, size) {
  const safe = weight >= 700 ? 700 : weight >= 600 ? 600 : weight >= 500 ? 500 : 400;
  return `${safe} ${size}px Inter, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
}

function fitText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.click();
}

function makeCanvas(width, height) {
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "top";
  return { canvas, ctx };
}

async function paintWhenReady() {
  await document.fonts.load(canvasFont(600, 32));
  await document.fonts.ready;
}

function drawReport(report) {
  const width = 1080;
  const pad = 56;
  const inner = width - pad * 2;
  const rowH = 86;
  const personH = 124;
  const height = 560 + report.items.length * rowH + Math.max(report.people.length, 1) * personH;
  const { canvas, ctx } = makeCanvas(width, height);

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#ff7a3c";
  ctx.font = canvasFont(650, 18);
  ctx.fillText(String(CONFIG.brand.fullName || "").toUpperCase(), pad, 52);

  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 52);
  ctx.fillText("Confirmados", pad, 84);

  ctx.fillStyle = "#98989f";
  ctx.font = canvasFont(500, 22);
  ctx.fillText(
    `${CONFIG.event.dateFull} · ${CONFIG.event.time} · ${CONFIG.event.place}`,
    pad,
    152
  );

  const stats = [
    [String(report.confirmedCount), "Confirmados"],
    [String(report.totalPeople), "Pessoas"],
    [String(report.openItems), "Itens livres"]
  ];
  const gap = 16;
  const boxW = (inner - gap * 2) / 3;
  stats.forEach(([value, label], index) => {
    const x = pad + index * (boxW + gap);
    const y = 210;
    ctx.fillStyle = "#141416";
    roundedRect(ctx, x, y, boxW, 110, 18);
    ctx.fill();
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 40);
    ctx.fillText(value, x + 22, y + 18);
    ctx.fillStyle = "#98989f";
    ctx.font = canvasFont(500, 18);
    ctx.fillText(label, x + 22, y + 68);
  });

  let y = 360;
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 26);
  ctx.fillText("Itens", pad, y);
  y += 46;

  report.items.forEach(item => {
    ctx.fillStyle = "#141416";
    roundedRect(ctx, pad, y, inner, 74, 16);
    ctx.fill();
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 22);
    ctx.fillText(fitText(ctx, item.name, inner - 140), pad + 20, y + 14);
    const count = `${item.claimed}/${item.capacity}`;
    ctx.fillStyle = "#98989f";
    ctx.font = canvasFont(600, 20);
    const countW = ctx.measureText(count).width;
    ctx.fillText(count, pad + inner - 20 - countW, y + 16);

    const barX = pad + 20;
    const barY = y + 48;
    const barW = inner - 40;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundedRect(ctx, barX, barY, barW, 8, 4);
    ctx.fill();
    const fillW = Math.max(item.pct > 0 ? 8 : 0, barW * item.pct / 100);
    ctx.fillStyle = item.claimed >= item.capacity ? "#ff6961" : "#ff7a3c";
    if (fillW) {
      roundedRect(ctx, barX, barY, Math.min(barW, fillW), 8, 4);
      ctx.fill();
    }
    y += rowH;
  });

  y += 18;
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 26);
  ctx.fillText("Quem confirmou", pad, y);
  y += 46;

  if (!report.people.length) {
    ctx.fillStyle = "#98989f";
    ctx.font = canvasFont(500, 20);
    ctx.fillText("Ainda não há confirmações.", pad, y);
  }

  report.people.forEach(person => {
    const cardH = 108;
    ctx.fillStyle = "#141416";
    roundedRect(ctx, pad, y, inner, cardH, 18);
    ctx.fill();

    ctx.font = canvasFont(650, 16);
    const badge = "Confirmado";
    const badgeW = ctx.measureText(badge).width + 28;
    const badgeH = 32;
    const badgeX = pad + inner - 18 - badgeW;
    const badgeY = y + (cardH - badgeH) / 2;
    ctx.fillStyle = "rgba(48, 209, 88, 0.16)";
    roundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 16);
    ctx.fill();
    ctx.fillStyle = "#30d158";
    ctx.fillText(badge, badgeX + 14, badgeY + 8);

    const textW = badgeX - pad - 36;
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 24);
    ctx.fillText(fitText(ctx, person.name, textW), pad + 20, y + 16);
    ctx.fillStyle = "#98989f";
    ctx.font = canvasFont(500, 16);
    ctx.fillText(fitText(ctx, person.email, textW), pad + 20, y + 48);
    ctx.fillText(fitText(ctx, person.item, textW), pad + 20, y + 72);
    y += personH;
  });

  return canvas;
}

function splitItemLabel(item) {
  const raw = String(item || "Sem contribuição").trim();
  const chars = [...raw];
  const icon = chars[0] || "";
  const title = chars.slice(1).join("").trim();
  const hasIcon = icon && title && /\p{Extended_Pictographic}/u.test(icon);
  return hasIcon ? { icon, title } : { icon: "", title: raw };
}

function drawTicketZigzag(ctx, width, y, tooth = 10) {
  const h = 14;
  ctx.beginPath();
  ctx.moveTo(0, y + h);
  for (let x = 0; x <= width; x += tooth) {
    ctx.lineTo(x + tooth / 2, y);
    ctx.lineTo(x + tooth, y + h);
  }
  ctx.closePath();
  ctx.fillStyle = "#050505";
  ctx.fill();
  ctx.strokeStyle = "#171719";
  ctx.lineWidth = 1.25;
  ctx.stroke();
  return y + h;
}

function drawVoucher(name, item) {
  const width = 420;
  const padX = 18;
  const cardPad = 12;
  const height = 720;
  const { canvas, ctx } = makeCanvas(width, height);

  // fundo transparente → preto sólido pra PNG
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, width, height);

  let y = 0;
  y = drawTicketZigzag(ctx, width, y, 10);

  // corpo do ticket
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, y - 1, width, height - (y - 1));
  ctx.strokeStyle = "#171719";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, y - 1, width - 1, height - (y - 1) - 0.5);

  const cx = width / 2;
  y += 28;

  // ícone check
  ctx.beginPath();
  ctx.fillStyle = "rgba(48, 209, 88, 0.14)";
  ctx.arc(cx, y + 24, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#30d158";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 9, y + 24);
  ctx.lineTo(cx - 2, y + 32);
  ctx.lineTo(cx + 11, y + 16);
  ctx.stroke();
  y += 60;

  ctx.textAlign = "center";
  ctx.fillStyle = "#ff7a3c";
  ctx.font = canvasFont(650, 11);
  ctx.fillText(String(CONFIG.brand.fullName || "").toUpperCase(), cx, y);
  y += 22;

  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 28);
  ctx.fillText(CONFIG.copy.receiptTitle, cx, y);
  y += 28;

  ctx.fillStyle = "#98989f";
  ctx.font = canvasFont(500, 14);
  ctx.fillText(CONFIG.copy.receiptLede, cx, y);
  y += 28;

  // card interno
  const cardX = padX;
  const cardW = width - padX * 2;
  const cardTop = y;
  const cardH = 320;
  ctx.fillStyle = "#0a0a0a";
  roundedRect(ctx, cardX, cardTop, cardW, cardH, 14);
  ctx.fill();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  roundedRect(ctx, cardX, cardTop, cardW, cardH, 14);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = "left";
  let cy = cardTop + cardPad + 2;
  const left = cardX + cardPad;
  const innerW = cardW - cardPad * 2;

  const drawLabel = text => {
    ctx.fillStyle = "#6e6e73";
    ctx.font = canvasFont(650, 9);
    ctx.fillText(text.toUpperCase(), left, cy);
    cy += 16;
  };

  const drawDivider = () => {
    cy += 6;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(left, cy);
    ctx.lineTo(left + innerW, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    cy += 14;
  };

  drawLabel("Seu nome");
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 15);
  ctx.fillText(fitText(ctx, name || "—", innerW), left, cy);
  cy += 22;
  drawDivider();

  drawLabel("Sua contribuição");
  const { icon, title } = splitItemLabel(item);
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 15);
  if (icon) {
    ctx.fillText(icon, left, cy);
    const iconW = ctx.measureText(icon).width;
    ctx.fillText(fitText(ctx, title, innerW - iconW - 8), left + iconW + 8, cy);
  } else {
    ctx.fillText(fitText(ctx, title, innerW), left, cy);
  }
  cy += 22;
  drawDivider();

  const cols = [
    ["Data", CONFIG.event.dateCompact],
    ["Horário", CONFIG.event.time],
    ["Local", CONFIG.event.place]
  ];
  const colW = innerW / 3;
  cols.forEach(([label, value], index) => {
    const x = left + colW * index;
    ctx.fillStyle = "#6e6e73";
    ctx.font = canvasFont(650, 9);
    ctx.fillText(label.toUpperCase(), x, cy);
    ctx.fillStyle = "#f5f5f7";
    ctx.font = canvasFont(600, 12);
    ctx.fillText(fitText(ctx, value, colW - 6), x, cy + 16);
  });
  cy += 42;

  // endereço (sem botão copiar / waze / uber)
  ctx.fillStyle = "#0e0e10";
  roundedRect(ctx, left, cy, innerW, 58, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  roundedRect(ctx, left, cy, innerW, 58, 10);
  ctx.stroke();

  ctx.fillStyle = "#6e6e73";
  ctx.font = canvasFont(650, 8);
  ctx.fillText("ENDEREÇO", left + 12, cy + 12);
  ctx.fillStyle = "#f5f5f7";
  ctx.font = canvasFont(600, 12);
  ctx.fillText(CONFIG.event.addressLine1, left + 12, cy + 28);
  ctx.fillText(CONFIG.event.addressLine2, left + 12, cy + 44);

  y = cardTop + cardH + 18;
  ctx.textAlign = "center";
  ctx.fillStyle = "#6e6e73";
  ctx.font = canvasFont(500, 12);
  ctx.fillText(CONFIG.copy.receiptFooter, cx, y);

  return canvas;
}

function fileSlug(value) {
  return String(value || "convidado")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "convidado";
}

$("exportAdmin").onclick = async () => {
  if (!isAdmin(userEmail())) return;
  const button = $("exportAdmin");
  setBusy(button, true, "Gerando...");
  try {
    await loadAdmin();
    if (!adminReport) throw new Error("Sem dados para exportar.");
    await paintWhenReady();
    downloadCanvas(drawReport(adminReport), "open-house-bbq-confirmados.png");
  } catch (error) {
    console.error(error);
    showToast({
      title: "Exportação falhou",
      text: "Não foi possível gerar a imagem do painel."
    }, "error");
  } finally {
    setBusy(button, false);
  }
};

async function loadHtml2Canvas() {
  if (window.html2canvas) return window.html2canvas;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Falha ao carregar gerador de imagem."));
    document.head.appendChild(script);
  });

  return window.html2canvas;
}

async function captureVoucherCanvas() {
  const source = document.querySelector("#receipt .sheet.ticket");
  if (!source) throw new Error("Voucher não encontrado.");

  const clone = source.cloneNode(true);
  clone.querySelectorAll(".receipt-exit, .ticket-toolbar, .nav-buttons, .sheet-backdrop").forEach(el => el.remove());

  const copyBtn = clone.querySelector(".copy-btn");
  if (copyBtn) {
    const label = copyBtn.querySelector(".copy-label");
    const address = document.createElement("div");
    address.className = "voucher-address";
    address.innerHTML = label ? label.innerHTML : copyBtn.innerHTML;
    copyBtn.replaceWith(address);
  }

  const body = clone.querySelector(".ticket-body");
  if (body) {
    body.style.maxHeight = "none";
    body.style.overflow = "visible";
    body.style.paddingBottom = "24px";
  }

  clone.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "width:420px",
    "max-height:none",
    "margin:0",
    "animation:none",
    "filter:none",
    "z-index:-1"
  ].join(";");

  document.body.appendChild(clone);

  try {
    const html2canvas = await loadHtml2Canvas();
    return await html2canvas(clone, {
      backgroundColor: "#050505",
      scale: 2,
      useCORS: true,
      logging: false
    });
  } finally {
    clone.remove();
  }
}

$("downloadVoucher").onclick = async () => {
  const button = $("downloadVoucher");
  setBusy(button, true, "Gerando...");
  try {
    await paintWhenReady();
    const name = $("receiptName").textContent.trim() || "Convidado";
    let canvas;
    try {
      canvas = await captureVoucherCanvas();
    } catch (captureError) {
      console.warn(captureError);
      const item = $("receiptItem").dataset.label?.trim()
        || $("receiptItem").textContent.trim()
        || "Sem contribuição";
      canvas = drawVoucher(name, item);
    }
    downloadCanvas(canvas, `voucher-${fileSlug(name)}.png`);
  } catch (error) {
    console.error(error);
    showToast({
      title: "Download falhou",
      text: "Não foi possível baixar o voucher agora."
    }, "error");
  } finally {
    setBusy(button, false);
  }
};
applyEventConfig();
